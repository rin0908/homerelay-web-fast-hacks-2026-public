import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSupabasePublicConfig: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: mocks.getSupabasePublicConfig,
}));

import { POST } from "@/app/logout/route";
import {
  SESSION_GUARD_COOKIE_NAME,
  signedOutSessionGuardValue,
} from "@/lib/supabase/session-guard";

function request({
  cookie,
  fetchMode = false,
  origin = "https://homerelay.test",
}: {
  cookie?: string;
  fetchMode?: boolean;
  origin?: string | null;
} = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (fetchMode) headers.set("x-homerelay-logout", "fetch");
  if (origin) headers.set("origin", origin);
  return new NextRequest("https://homerelay.test/logout", {
    headers,
    method: "POST",
  });
}

describe("POST /logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: { signOut: mocks.signOut },
    } as unknown as SupabaseClient);
  });

  it("keeps demo or missing-environment mode available", async () => {
    mocks.getSupabasePublicConfig.mockReturnValue(null);

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://homerelay.test/");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value).toBe(
      signedOutSessionGuardValue(),
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each([null, "https://attacker.test"])(
    "rejects a missing or cross-origin POST (%s)",
    async (origin) => {
      const response = await POST(request({ origin }));

      expect(response.status).toBe(403);
      expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)).toBeUndefined();
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("sets signed-out server-side and deletes only HomeRelay auth cookies", async () => {
    const response = await POST(
      request({
        cookie: [
          "sb-synthetic-auth-token=session",
          "sb-synthetic-auth-token.1=chunk",
          "sb-other-auth-token=keep",
          "unrelated=keep",
        ].join("; "),
      }),
    );

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/login?loggedOut=1",
    );
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      value: signedOutSessionGuardValue(),
    });
    expect(response.cookies.get("sb-synthetic-auth-token")?.maxAge).toBe(0);
    expect(response.cookies.get("sb-synthetic-auth-token.1")?.maxAge).toBe(0);
    expect(response.cookies.get("sb-other-auth-token")).toBeUndefined();
    expect(response.cookies.get("unrelated")).toBeUndefined();
  });

  it("keeps signed-out authoritative when provider revocation fails", async () => {
    mocks.signOut.mockRejectedValue(new Error("synthetic provider failure"));

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/login?loggedOut=1",
    );
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value).toBe(
      signedOutSessionGuardValue(),
    );
  });

  it("returns a compact success response to the locked client flow", async () => {
    const response = await POST(request({ fetchMode: true }));

    expect(response.status).toBe(204);
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value).toBe(
      signedOutSessionGuardValue(),
    );
  });
});
