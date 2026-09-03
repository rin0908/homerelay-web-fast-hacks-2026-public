import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  clientOptions: null as {
    cookies: {
      getAll: () => { name: string; value: string }[];
      setAll: (
        cookies: {
          name: string;
          options: Record<string, unknown>;
          value: string;
        }[],
        headers: Record<string, string>,
      ) => void;
    };
  } | null,
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  resolveCurrentSession: vi.fn(),
  getSupabasePublicConfig: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/supabase/session", () => ({
  resolveCurrentSession: mocks.resolveCurrentSession,
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
    mocks.clientOptions = null;
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      mocks.clientOptions = options;
      return { auth: { getClaims: mocks.getClaims } };
    });
    mocks.resolveCurrentSession.mockResolvedValue({
      session: {
        member: { role: "helper" },
        sessionId: SESSION_ID,
        userId: AUTH_USER_ID,
      },
      state: "verified",
    });
  });

  it("requires a same-origin POST", async () => {
    const response = await POST(request("begin", { origin: null }));

    expect(response.status).toBe(403);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
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

  it.each([401, 403])(
    "does not treat an unknown begin status %i as signed-out",
    async (status) => {
      const guard = await activeSessionGuardValue(SESSION_ID);
      mocks.getClaims.mockResolvedValue({ data: null, error: { status } });

      const response = await POST(
        request("begin", {
          cookie: `${SESSION_GUARD_COOKIE_NAME}=${guard}; sb-synthetic-auth-token=current`,
        }),
      );

      expect(response.status).toBe(503);
      expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)).toBeUndefined();
      expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
    },
  );

  it("discards SDK cookie and header mutations when begin is indeterminate", async () => {
    const guard = await activeSessionGuardValue(SESSION_ID);
    const deviceRequest = request("begin", {
      cookie: [
        `${SESSION_GUARD_COOKIE_NAME}=${guard}`,
        "sb-synthetic-auth-token=current",
      ].join("; "),
    });
    mocks.getClaims.mockImplementation(async () => {
      mocks.clientOptions?.cookies.setAll(
        [
          {
            name: "sb-synthetic-auth-token",
            options: { httpOnly: true, path: "/" },
            value: "unchecked-refresh",
          },
        ],
        { "x-unchecked-refresh": "blocked" },
      );
      return { data: null, error: { status: 429 } };
    });

    const response = await POST(deviceRequest);

    expect(response.status).toBe(503);
    expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
    expect(response.headers.get("x-unchecked-refresh")).toBeNull();
    expect(deviceRequest.cookies.get("sb-synthetic-auth-token")?.value).toBe(
      "current",
    );
  });

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

  it.each(["resolved indeterminate", "thrown error"])(
    "preserves cookies when completion is %s",
    async (failureMode) => {
      if (failureMode === "resolved indeterminate") {
        mocks.resolveCurrentSession.mockImplementation(async () => {
          mocks.clientOptions?.cookies.setAll(
            [
              {
                name: "sb-synthetic-auth-token",
                options: { httpOnly: true, path: "/" },
                value: "unchecked-refresh",
              },
            ],
            { "x-unchecked-refresh": "blocked" },
          );
          return { state: "indeterminate" };
        });
      } else {
        mocks.resolveCurrentSession.mockRejectedValue(
          new Error("synthetic session failure"),
        );
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

      expect(response.status).toBe(503);
      expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)).toBeUndefined();
      expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
      expect(response.headers.get("x-unchecked-refresh")).toBeNull();
    },
  );

  it("rejects another user between verification and completion", async () => {
    const body = {
      authUserId: "synthetic-other-user",
      expectedRole: "helper",
    };

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

  it("reports a confirmed role mismatch as forbidden", async () => {
    const response = await POST(
      request("complete", {
        body: { authUserId: AUTH_USER_ID, expectedRole: "family" },
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${signedOutSessionGuardValue()}`,
      }),
    );

    expect(response.status).toBe(403);
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value).toBe(
      signedOutSessionGuardValue(),
    );
  });

  it("reports confirmed membership absence as forbidden", async () => {
    mocks.resolveCurrentSession.mockResolvedValue({ state: "forbidden" });

    const response = await POST(
      request("complete", {
        body: { authUserId: AUTH_USER_ID, expectedRole: "helper" },
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${signedOutSessionGuardValue()}`,
      }),
    );

    expect(response.status).toBe(403);
    expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
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
    expect(mocks.resolveCurrentSession).not.toHaveBeenCalled();
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
    expect(mocks.resolveCurrentSession).not.toHaveBeenCalled();
  });
});
