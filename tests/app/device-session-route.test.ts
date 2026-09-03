import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  getCurrentSession: vi.fn(),
  getSupabasePublicConfig: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: mocks.getSupabasePublicConfig,
}));

import { POST } from "@/app/login/device/session/route";
import {
  activeSessionGuardValue,
  readSessionGuard,
  SESSION_GUARD_COOKIE_NAME,
  signedOutSessionGuardValue,
} from "@/lib/supabase/session-guard";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_USER_ID = "synthetic-helper-user";

function request(
  phase: "begin" | "complete",
  {
    body,
    cookie,
    origin = "https://homerelay.test",
  }: { body?: unknown; cookie?: string; origin?: string | null } = {},
) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(
    `https://homerelay.test/login/device/session?phase=${phase}`,
    {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method: "POST",
    },
  );
}

describe("device session guard route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    mocks.createClient.mockResolvedValue({
      auth: { getClaims: mocks.getClaims },
    } as unknown as SupabaseClient);
    mocks.getCurrentSession.mockResolvedValue({
      member: { role: "helper" },
      sessionId: SESSION_ID,
      userId: AUTH_USER_ID,
    });
  });

  it("requires a same-origin POST", async () => {
    const response = await POST(request("begin", { origin: null }));

    expect(response.status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("begins a device CAS by setting signed-out and clearing only HomeRelay auth", async () => {
    const response = await POST(
      request("begin", {
        cookie:
          "sb-synthetic-auth-token=stale; sb-other-auth-token=keep; unrelated=keep",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value).toBe(
      signedOutSessionGuardValue(),
    );
    expect(response.cookies.get("sb-synthetic-auth-token")?.maxAge).toBe(0);
    expect(response.cookies.get("sb-other-auth-token")).toBeUndefined();
    expect(response.cookies.get("unrelated")).toBeUndefined();
  });

  it("does not begin over an existing matching active session", async () => {
    const guard = await activeSessionGuardValue(SESSION_ID);
    mocks.getClaims.mockResolvedValue({
      data: { claims: { session_id: SESSION_ID, sub: AUTH_USER_ID } },
      error: null,
    });

    const response = await POST(
      request("begin", {
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${guard}`,
      }),
    );

    expect(response.status).toBe(409);
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)).toBeUndefined();
  });

  it.each(["error result", "thrown error"])(
    "does not clear an existing session when begin claims return an %s",
    async (failureMode) => {
      const guard = await activeSessionGuardValue(SESSION_ID);
      if (failureMode === "error result") {
        mocks.getClaims.mockResolvedValue({
          data: null,
          error: new Error("synthetic claims error"),
        });
      } else {
        mocks.getClaims.mockRejectedValue(new Error("synthetic claims failure"));
      }

      const response = await POST(
        request("begin", {
          cookie: [
            `${SESSION_GUARD_COOKIE_NAME}=${guard}`,
            "sb-synthetic-auth-token=current",
          ].join("; "),
        }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false });
      expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)).toBeUndefined();
      expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
    },
  );

  it("completes only the exact verified user, role, membership, and session", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { session_id: SESSION_ID, sub: AUTH_USER_ID } },
      error: null,
    });
    const response = await POST(
      request("complete", {
        body: { authUserId: AUTH_USER_ID, expectedRole: "helper" },
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${signedOutSessionGuardValue()}`,
      }),
    );

    expect(response.status).toBe(200);
    const guard = readSessionGuard(
      response.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value,
    );
    expect(guard.state).toBe("active");
  });

  it.each(["error result", "thrown error"])(
    "fails closed when getClaims returns an %s during completion",
    async (failureMode) => {
      if (failureMode === "error result") {
        mocks.getClaims.mockResolvedValue({
          data: { claims: { session_id: SESSION_ID, sub: AUTH_USER_ID } },
          error: new Error("synthetic claims error"),
        });
      } else {
        mocks.getClaims.mockRejectedValue(new Error("synthetic claims failure"));
      }

      const response = await POST(
        request("complete", {
          body: { authUserId: AUTH_USER_ID, expectedRole: "helper" },
          cookie: [
            `${SESSION_GUARD_COOKIE_NAME}=${signedOutSessionGuardValue()}`,
            "sb-synthetic-auth-token=stale",
          ].join("; "),
        }),
      );

      expect(response.status).toBe(401);
      expect(
        readSessionGuard(response.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value)
          .state,
      ).toBe("signed-out");
      expect(response.cookies.get("sb-synthetic-auth-token")?.maxAge).toBe(0);
    },
  );

  it.each([
    {
      body: { authUserId: "synthetic-other-user", expectedRole: "helper" },
      name: "another user",
    },
    {
      body: { authUserId: AUTH_USER_ID, expectedRole: "family" },
      name: "another role",
    },
  ])("rejects $name between verification and completion", async ({ body }) => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { session_id: SESSION_ID, sub: AUTH_USER_ID } },
      error: null,
    });

    const response = await POST(
      request("complete", {
        body,
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${signedOutSessionGuardValue()}`,
      }),
    );

    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value).toBe(
      signedOutSessionGuardValue(),
    );
  });

  it("rejects completion unless begin established signed-out first", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { session_id: SESSION_ID, sub: AUTH_USER_ID } },
      error: null,
    });

    const response = await POST(
      request("complete", {
        body: { authUserId: AUTH_USER_ID, expectedRole: "helper" },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("rejects an oversized completion body before parsing JSON", async () => {
    const response = await POST(
      request("complete", {
        body: {
          authUserId: "x".repeat(600),
          expectedRole: "helper",
        },
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${signedOutSessionGuardValue()}`,
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });
});
