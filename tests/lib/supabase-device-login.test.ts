import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { consumeDeviceMagicLink } from "@/lib/supabase/device-login";

const TOKEN = "synthetic_device_token_000000000000000000000000";

function client({
  claimsUserId = "synthetic-helper-user",
  memberRole = "helper",
  membershipError = null,
  signOutResults = [{ clearsSession: true, error: null }],
  verifyError = null,
}: {
  claimsUserId?: string | null;
  memberRole?: string | null;
  membershipError?: Error | null;
  signOutResults?: Array<{
    clearsSession: boolean;
    error: Error | null;
  }>;
  verifyError?: Error | null;
} = {}) {
  let sessionActive = true;
  let signOutAttempt = 0;
  const maybeSingle = vi.fn().mockResolvedValue({
    data:
      memberRole === null
        ? null
        : {
            auth_user_id: claimsUserId,
            id: "synthetic-helper-member",
            role: memberRole,
          },
    error: membershipError,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const signOut = vi.fn(async () => {
    const result =
      signOutResults[
        Math.min(signOutAttempt, Math.max(signOutResults.length - 1, 0))
      ];
    signOutAttempt += 1;
    if (result?.clearsSession) sessionActive = false;
    return { error: result?.error ?? null };
  });
  const getSession = vi.fn(async () => ({
    data: {
      session: sessionActive
        ? { access_token: "synthetic-access-token" }
        : null,
    },
    error: null,
  }));
  const verifyOtp = vi.fn().mockResolvedValue({ error: verifyError });
  const getClaims = vi.fn().mockResolvedValue({
    data: { claims: { sub: claimsUserId } },
    error: null,
  });
  return {
    client: {
      auth: { getClaims, getSession, signOut, verifyOtp },
      from: vi.fn(() => ({ select })),
    } as unknown as SupabaseClient,
    getClaims,
    getSession,
    maybeSingle,
    sessionIsActive: () => sessionActive,
    signOut,
    verifyOtp,
  };
}

function hash(token = TOKEN) {
  return `#token_hash=${encodeURIComponent(token)}&type=magiclink`;
}

describe("one-time device login", () => {
  it.each([
    "",
    "#type=magiclink",
    "#token_hash=short&type=magiclink",
    `#token_hash=${TOKEN}&type=recovery`,
    `#token_hash=${TOKEN}&token_hash=${TOKEN}&type=magiclink`,
    `#token_hash=${TOKEN}&type=magiclink&next=https://example.test`,
  ])("rejects malformed fragments before Supabase verification", async (value) => {
    const runtime = client();

    await expect(
      consumeDeviceMagicLink(runtime.client, value, "helper"),
    ).resolves.toBe("invalid");
    expect(runtime.verifyOtp).not.toHaveBeenCalled();
    expect(runtime.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("verifies a one-time magic link and requires the helper membership", async () => {
    const runtime = client();

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "helper"),
    ).resolves.toBe("success");
    expect(runtime.verifyOtp).toHaveBeenCalledWith({
      token_hash: TOKEN,
      type: "magiclink",
    });
    expect(runtime.getClaims).toHaveBeenCalledOnce();
    expect(runtime.signOut).not.toHaveBeenCalled();
  });

  it("fails closed and removes a session without helper membership", async () => {
    const runtime = client({ memberRole: "family" });

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "helper"),
    ).resolves.toBe("membership");
    expect(runtime.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(runtime.getSession).toHaveBeenCalledOnce();
    expect(runtime.sessionIsActive()).toBe(false);
  });

  it("accepts a resolved sign-out error only after the local session is gone", async () => {
    const runtime = client({
      memberRole: "family",
      signOutResults: [
        {
          clearsSession: true,
          error: new Error("synthetic remote sign-out failure"),
        },
      ],
    });

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "helper"),
    ).resolves.toBe("membership");
    expect(runtime.signOut).toHaveBeenCalledOnce();
    expect(runtime.getSession).toHaveBeenCalledOnce();
    expect(runtime.sessionIsActive()).toBe(false);
  });

  it("retries the supported local sign-out when the first attempt leaves a session", async () => {
    const runtime = client({
      memberRole: "family",
      signOutResults: [
        {
          clearsSession: false,
          error: null,
        },
        { clearsSession: true, error: null },
      ],
    });

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "helper"),
    ).resolves.toBe("membership");
    expect(runtime.signOut).toHaveBeenCalledTimes(2);
    expect(runtime.getSession).toHaveBeenCalledTimes(2);
    expect(runtime.sessionIsActive()).toBe(false);
  });

  it("does not report a role rejection as safely handled while its session remains", async () => {
    const failure = new Error("synthetic persistent sign-out failure");
    const runtime = client({
      memberRole: "family",
      signOutResults: [
        { clearsSession: false, error: failure },
        { clearsSession: false, error: failure },
      ],
    });

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(runtime.signOut).toHaveBeenCalledTimes(2);
    expect(runtime.getSession).toHaveBeenCalledTimes(2);
    expect(runtime.sessionIsActive()).toBe(true);
  });

  it("does not create a session when Supabase rejects the one-time token", async () => {
    const runtime = client({ verifyError: new Error("synthetic rejection") });

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "helper"),
    ).resolves.toBe("invalid");
    expect(runtime.getClaims).not.toHaveBeenCalled();
    expect(runtime.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("fails closed when membership lookup is unavailable", async () => {
    const runtime = client({
      membershipError: new Error("synthetic lookup failure"),
    });

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "helper"),
    ).resolves.toBe("membership");
    expect(runtime.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("accepts the exact family membership on the family-only route", async () => {
    const runtime = client({ memberRole: "family" });

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "family"),
    ).resolves.toBe("success");
    expect(runtime.signOut).not.toHaveBeenCalled();
  });

  it("fails closed when a helper token reaches the family-only route", async () => {
    const runtime = client({ memberRole: "helper" });

    await expect(
      consumeDeviceMagicLink(runtime.client, hash(), "family"),
    ).resolves.toBe("membership");
    expect(runtime.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
