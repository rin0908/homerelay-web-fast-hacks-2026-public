import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumeDeviceMagicLink } from "@/lib/supabase/device-login";
import { withAuthSessionLock } from "@/lib/supabase/auth-session-lock";

const TOKEN = "synthetic_device_token_000000000000000000000000";
const ACCESS_TOKEN = "synthetic-access-token";
const REFRESH_TOKEN = "synthetic-refresh-token";
const REFRESHED_ACCESS_TOKEN = "synthetic-refreshed-access-token";
const REFRESHED_REFRESH_TOKEN = "synthetic-refreshed-refresh-token";
const COMPETING_ACCESS_TOKEN = "synthetic-competing-access-token";
const COMPETING_REFRESH_TOKEN = "synthetic-competing-refresh-token";

type TestLockCallback = (lock: Lock | null) => unknown;
let authLockHeld = false;

function serialLockManager() {
  let tail: Promise<unknown> = Promise.resolve();
  const request = vi.fn(
    (name: string, _options: LockOptions, callback: TestLockCallback) => {
      const result = tail.then(async () => {
        authLockHeld = true;
        try {
          return await callback({ name, mode: "exclusive" } as Lock);
        } finally {
          authLockHeld = false;
        }
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  );

  return { request };
}

function runtime({
  claimsUserId = "synthetic-helper-user",
  memberRole = "helper",
  membershipError = null,
  persistentAccessToken = null,
  persistentSignOutClears = true,
  persistentSignOutError = null,
  setSessionError = null,
  verifyError = null,
}: {
  claimsUserId?: string | null;
  memberRole?: string | null;
  membershipError?: Error | null;
  persistentAccessToken?: string | null;
  persistentSignOutClears?: boolean;
  persistentSignOutError?: Error | null;
  setSessionError?: Error | null;
  verifyError?: Error | null;
} = {}) {
  let currentPersistentSession = persistentAccessToken
    ? {
        access_token: persistentAccessToken,
        refresh_token: `${persistentAccessToken}-refresh`,
      }
    : null;
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
  const verifyOtp = vi.fn().mockResolvedValue({
    data: {
      session: verifyError
        ? null
        : {
            access_token: ACCESS_TOKEN,
            refresh_token: REFRESH_TOKEN,
          },
    },
    error: verifyError,
  });
  const getClaims = vi.fn().mockResolvedValue({
    data: { claims: { sub: claimsUserId } },
    error: null,
  });
  const verificationSignOut = vi.fn().mockResolvedValue({ error: null });
  const verificationDispose = vi.fn().mockResolvedValue(undefined);
  const setSession = vi.fn(async (session: {
    access_token: string;
    refresh_token: string;
  }) => {
    if (setSessionError) {
      return { data: { session: null }, error: setSessionError };
    }
    currentPersistentSession = session;
    return {
      data: { session },
      error: null,
    };
  });
  const persistentGetSession = vi.fn(async () => ({
    data: {
      session: currentPersistentSession,
    },
    error: null,
  }));
  const persistentSignOut = vi.fn(async () => {
    if (persistentSignOutClears) currentPersistentSession = null;
    return { error: persistentSignOutError };
  });
  const persistentDispose = vi.fn().mockResolvedValue(undefined);
  const persistentClient = {
    auth: {
      dispose: persistentDispose,
      getSession: persistentGetSession,
      setSession,
      signOut: persistentSignOut,
    },
  } as unknown as SupabaseClient;
  const verificationClient = {
    auth: {
      dispose: verificationDispose,
      getClaims,
      signOut: verificationSignOut,
      verifyOtp,
    },
    from: vi.fn(() => ({ select })),
  } as unknown as SupabaseClient;
  const createPersistentClient = vi.fn((): SupabaseClient | null => {
    expect(authLockHeld).toBe(true);
    return persistentClient;
  });
  const createVerificationClient = vi.fn((): SupabaseClient | null => {
    expect(authLockHeld).toBe(true);
    return verificationClient;
  });

  return {
    clients: {
      createPersistentClient,
      createVerificationClient,
    },
    createPersistentClient,
    createVerificationClient,
    getClaims,
    maybeSingle,
    persistentGetSession,
    persistentDispose,
    persistentSession: () => currentPersistentSession,
    persistentSignOut,
    setPersistentSession: (
      accessToken: string | null,
      refreshToken = `${accessToken}-refresh`,
      userId?: string,
    ) => {
      currentPersistentSession = accessToken
        ? {
            access_token: accessToken,
            refresh_token: refreshToken,
            ...(userId ? { user: { id: userId } } : {}),
          }
        : null;
    },
    setSession,
    verificationDispose,
    verificationSignOut,
    verifyOtp,
  };
}

function hash(token = TOKEN) {
  return `#token_hash=${encodeURIComponent(token)}&type=magiclink`;
}

describe("one-time device login", () => {
  beforeEach(() => {
    authLockHeld = false;
    vi.stubGlobal("navigator", { locks: serialLockManager() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    "",
    "#type=magiclink",
    "#token_hash=short&type=magiclink",
    `#token_hash=${TOKEN}&type=recovery`,
    `#token_hash=${TOKEN}&token_hash=${TOKEN}&type=magiclink`,
    `#token_hash=${TOKEN}&type=magiclink&next=https://example.test`,
  ])("rejects malformed fragments without touching persistent auth", async (value) => {
    const testRuntime = runtime();

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, value, "helper"),
    ).resolves.toBe("invalid");
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.persistentGetSession).not.toHaveBeenCalled();
    expect(testRuntime.persistentSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationDispose).not.toHaveBeenCalled();
    expect(testRuntime.persistentDispose).not.toHaveBeenCalled();
    expect(testRuntime.createPersistentClient).not.toHaveBeenCalled();
    expect(testRuntime.createVerificationClient).not.toHaveBeenCalled();
  });

  it("returns unavailable without escaping the lock when a client factory throws", async () => {
    const testRuntime = runtime();
    testRuntime.createPersistentClient.mockImplementation(() => {
      expect(authLockHeld).toBe(true);
      throw new Error("synthetic factory failure");
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.createPersistentClient).toHaveBeenCalledOnce();
    expect(testRuntime.createVerificationClient).toHaveBeenCalledOnce();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
  });

  it("returns unavailable and disposes a created client when its peer factory returns null", async () => {
    const testRuntime = runtime();
    testRuntime.createPersistentClient.mockImplementation(() => {
      expect(authLockHeld).toBe(true);
      return null;
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.createPersistentClient).toHaveBeenCalledOnce();
    expect(testRuntime.createVerificationClient).toHaveBeenCalledOnce();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
    expect(testRuntime.persistentDispose).not.toHaveBeenCalled();
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
  });

  it("revokes an ephemeral session when verifyOtp saves and then rejects", async () => {
    const testRuntime = runtime();
    testRuntime.verifyOtp.mockRejectedValue(
      new Error("synthetic subscriber failure after save"),
    );

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledWith({
      scope: "local",
    });
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("verifies membership ephemerally before persisting the session", async () => {
    const testRuntime = runtime();

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("success");
    expect(testRuntime.verifyOtp).toHaveBeenCalledWith({
      token_hash: TOKEN,
      type: "magiclink",
    });
    expect(testRuntime.getClaims).toHaveBeenCalledOnce();
    expect(testRuntime.setSession).toHaveBeenCalledWith({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    });
    expect(testRuntime.persistentGetSession).toHaveBeenCalledTimes(3);
    expect(testRuntime.persistentSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("keeps device begin, transfer, and exact completion inside one auth lock", async () => {
    const testRuntime = runtime();
    const preparePersistentSession = vi.fn(async () => {
      expect(authLockHeld).toBe(true);
      return true;
    });
    const completePersistentSession = vi.fn(async (verification) => {
      expect(authLockHeld).toBe(true);
      expect(testRuntime.persistentSession()).not.toBeNull();
      expect(verification).toEqual({
        authUserId: "synthetic-helper-user",
        expectedRole: "helper",
      });
      return true;
    });

    await expect(
      consumeDeviceMagicLink(
        {
          ...testRuntime.clients,
          completePersistentSession,
          preparePersistentSession,
        },
        hash(),
        "helper",
      ),
    ).resolves.toBe("success");
    expect(preparePersistentSession).toHaveBeenCalledOnce();
    expect(completePersistentSession).toHaveBeenCalledOnce();
    expect(preparePersistentSession.mock.invocationCallOrder[0]).toBeLessThan(
      testRuntime.createVerificationClient.mock.invocationCallOrder[0],
    );
    expect(testRuntime.setSession.mock.invocationCallOrder[0]).toBeLessThan(
      completePersistentSession.mock.invocationCallOrder[0],
    );
  });

  it("does not consume a one-time token when device begin fails", async () => {
    const testRuntime = runtime();
    const preparePersistentSession = vi.fn().mockResolvedValue(false);

    await expect(
      consumeDeviceMagicLink(
        { ...testRuntime.clients, preparePersistentSession },
        hash(),
        "helper",
      ),
    ).resolves.toBe("unavailable");
    expect(testRuntime.createVerificationClient).not.toHaveBeenCalled();
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
  });

  it("fails closed when the server does not activate the transferred session", async () => {
    const testRuntime = runtime();
    const completePersistentSession = vi.fn().mockResolvedValue(false);

    await expect(
      consumeDeviceMagicLink(
        { ...testRuntime.clients, completePersistentSession },
        hash(),
        "helper",
      ),
    ).resolves.toBe("unavailable");
    expect(testRuntime.setSession).toHaveBeenCalledOnce();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
  });

  it("preserves an unrelated persistent session when membership is rejected", async () => {
    const testRuntime = runtime({
      memberRole: "family",
      persistentAccessToken: "synthetic-newer-session",
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.persistentGetSession).toHaveBeenCalledOnce();
    expect(testRuntime.persistentSignOut).not.toHaveBeenCalled();
    expect(testRuntime.persistentSession()?.access_token).toBe(
      "synthetic-newer-session",
    );
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("does not persist when Supabase rejects the one-time token", async () => {
    const testRuntime = runtime({
      verifyError: new Error("synthetic rejection"),
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("invalid");
    expect(testRuntime.getClaims).not.toHaveBeenCalled();
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("fails closed when verification omits session credentials", async () => {
    const testRuntime = runtime();
    testRuntime.verifyOtp.mockResolvedValue({
      data: { session: { access_token: ACCESS_TOKEN } },
      error: null,
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.getClaims).not.toHaveBeenCalled();
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledWith({
      scope: "local",
    });
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("fails closed when membership lookup is unavailable", async () => {
    const testRuntime = runtime({
      membershipError: new Error("synthetic lookup failure"),
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("membership");
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("accepts the exact family membership on the family-only route", async () => {
    const testRuntime = runtime({ memberRole: "family" });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "family"),
    ).resolves.toBe("success");
    expect(testRuntime.setSession).toHaveBeenCalledOnce();
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("fails closed when a helper token reaches the family-only route", async () => {
    const testRuntime = runtime({ memberRole: "helper" });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "family"),
    ).resolves.toBe("membership");
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("refuses to overwrite a persistent session established first", async () => {
    const testRuntime = runtime({
      persistentAccessToken: "synthetic-newer-session",
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
    expect(testRuntime.persistentGetSession).toHaveBeenCalledOnce();
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.persistentSignOut).not.toHaveBeenCalled();
    expect(testRuntime.persistentSession()?.access_token).toBe(
      "synthetic-newer-session",
    );
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("fails closed and revokes the ephemeral session when transfer fails", async () => {
    const testRuntime = runtime({
      setSessionError: new Error("synthetic transfer failure"),
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.setSession).toHaveBeenCalledOnce();
    expect(testRuntime.persistentSignOut).not.toHaveBeenCalled();
    expect(testRuntime.persistentSession()).toBeNull();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("requires a matching cookie read-back after setSession reports success", async () => {
    const testRuntime = runtime();
    testRuntime.setSession.mockResolvedValue({
      data: {
        session: {
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
        },
      },
      error: null,
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.persistentSession()).toBeNull();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
  });

  it("accepts refreshed credentials returned by setSession after matching read-back", async () => {
    const testRuntime = runtime();
    testRuntime.setSession.mockImplementation(async () => {
      testRuntime.setPersistentSession(
        REFRESHED_ACCESS_TOKEN,
        REFRESHED_REFRESH_TOKEN,
      );
      return {
        data: {
          session: {
            access_token: REFRESHED_ACCESS_TOKEN,
            refresh_token: REFRESHED_REFRESH_TOKEN,
          },
        },
        error: null,
      };
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("success");
    expect(testRuntime.setSession).toHaveBeenCalledWith({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    });
    expect(testRuntime.persistentSession()).toEqual({
      access_token: REFRESHED_ACCESS_TOKEN,
      refresh_token: REFRESHED_REFRESH_TOKEN,
    });
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
  });

  it("removes only the candidate session when a failed transfer wrote it", async () => {
    const testRuntime = runtime();
    testRuntime.setSession.mockImplementation(async (session) => {
      testRuntime.setPersistentSession(
        session.access_token,
        session.refresh_token,
      );
      return {
        data: { session: null },
        error: new Error("synthetic transfer failure after write"),
      };
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.persistentSignOut).toHaveBeenCalledOnce();
    expect(testRuntime.persistentSession()).toBeNull();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("accepts a sign-out error only after candidate cleanup reads back empty", async () => {
    const testRuntime = runtime({
      persistentSignOutError: new Error("synthetic remote sign-out error"),
    });
    testRuntime.setSession.mockImplementation(async (session) => {
      testRuntime.setPersistentSession(
        session.access_token,
        session.refresh_token,
      );
      return {
        data: { session: null },
        error: new Error("synthetic transfer failure after write"),
      };
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.persistentSignOut).toHaveBeenCalledOnce();
    expect(testRuntime.persistentSession()).toBeNull();
  });

  it("bounds candidate cleanup retries when local sign-out retains it", async () => {
    const testRuntime = runtime({ persistentSignOutClears: false });
    testRuntime.setSession.mockImplementation(async (session) => {
      testRuntime.setPersistentSession(
        session.access_token,
        session.refresh_token,
      );
      return {
        data: { session: null },
        error: new Error("synthetic transfer failure after write"),
      };
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.persistentSignOut).toHaveBeenCalledTimes(2);
    expect(testRuntime.persistentSession()).toEqual({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    });
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
  });

  it("accepts a transfer that persisted before a subscriber threw", async () => {
    const testRuntime = runtime();
    testRuntime.setSession.mockImplementation(async () => {
      testRuntime.setPersistentSession(ACCESS_TOKEN, REFRESH_TOKEN);
      throw new Error("synthetic subscriber failure");
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("success");
    expect(testRuntime.persistentGetSession).toHaveBeenCalledTimes(3);
    expect(testRuntime.persistentSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationDispose).toHaveBeenCalledOnce();
  });

  it("accepts a rotated verified-user session persisted before a subscriber threw", async () => {
    const testRuntime = runtime();
    testRuntime.setSession.mockImplementation(async () => {
      testRuntime.setPersistentSession(
        REFRESHED_ACCESS_TOKEN,
        REFRESHED_REFRESH_TOKEN,
        "synthetic-helper-user",
      );
      throw new Error("synthetic subscriber failure after token rotation");
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("success");
    expect(testRuntime.persistentSession()).toMatchObject({
      access_token: REFRESHED_ACCESS_TOKEN,
      refresh_token: REFRESHED_REFRESH_TOKEN,
      user: { id: "synthetic-helper-user" },
    });
    expect(testRuntime.persistentSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
  });

  it("rejects and preserves a different user's rotated session after a subscriber threw", async () => {
    const testRuntime = runtime();
    testRuntime.setSession.mockImplementation(async () => {
      testRuntime.setPersistentSession(
        REFRESHED_ACCESS_TOKEN,
        REFRESHED_REFRESH_TOKEN,
        "synthetic-different-user",
      );
      throw new Error("synthetic subscriber failure after account change");
    });

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.persistentSession()).toMatchObject({
      access_token: REFRESHED_ACCESS_TOKEN,
      refresh_token: REFRESHED_REFRESH_TOKEN,
      user: { id: "synthetic-different-user" },
    });
    expect(testRuntime.persistentSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
  });

  it("holds the lock from verification through transfer so a later password login wins", async () => {
    const testRuntime = runtime();
    let markVerificationStarted!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      markVerificationStarted = resolve;
    });
    let finishVerification!: () => void;
    const verificationCanFinish = new Promise<void>((resolve) => {
      finishVerification = resolve;
    });
    testRuntime.verifyOtp.mockImplementation(async () => {
      markVerificationStarted();
      await verificationCanFinish;
      return {
        data: {
          session: {
            access_token: ACCESS_TOKEN,
            refresh_token: REFRESH_TOKEN,
          },
        },
        error: null,
      };
    });

    const deviceOutcome = consumeDeviceMagicLink(
      testRuntime.clients,
      hash(),
      "helper",
    );
    await verificationStarted;

    let passwordLoginRan = false;
    const passwordLogin = withAuthSessionLock(async () => {
      passwordLoginRan = true;
      testRuntime.setPersistentSession(
        COMPETING_ACCESS_TOKEN,
        COMPETING_REFRESH_TOKEN,
      );
    });
    expect(passwordLoginRan).toBe(false);

    finishVerification();
    await expect(deviceOutcome).resolves.toBe("success");
    await passwordLogin;
    expect(passwordLoginRan).toBe(true);
    expect(testRuntime.persistentSession()).toEqual({
      access_token: COMPETING_ACCESS_TOKEN,
      refresh_token: COMPETING_REFRESH_TOKEN,
    });
  });

  it("re-reads before transfer and preserves a non-cooperating login that completed during verification", async () => {
    const testRuntime = runtime();
    let markVerificationStarted!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      markVerificationStarted = resolve;
    });
    let finishVerification!: () => void;
    const verificationCanFinish = new Promise<void>((resolve) => {
      finishVerification = resolve;
    });
    testRuntime.verifyOtp.mockImplementation(async () => {
      markVerificationStarted();
      await verificationCanFinish;
      return {
        data: {
          session: {
            access_token: ACCESS_TOKEN,
            refresh_token: REFRESH_TOKEN,
          },
        },
        error: null,
      };
    });

    const deviceOutcome = consumeDeviceMagicLink(
      testRuntime.clients,
      hash(),
      "helper",
    );
    await verificationStarted;
    testRuntime.setPersistentSession(
      COMPETING_ACCESS_TOKEN,
      COMPETING_REFRESH_TOKEN,
    );
    finishVerification();

    await expect(deviceOutcome).resolves.toBe("unavailable");
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.persistentSession()).toEqual({
      access_token: COMPETING_ACCESS_TOKEN,
      refresh_token: COMPETING_REFRESH_TOKEN,
    });
    expect(testRuntime.verificationSignOut).toHaveBeenCalledOnce();
  });

  it("waits for an earlier password login and then refuses the device transfer", async () => {
    const testRuntime = runtime();
    let markPasswordLoginStarted!: () => void;
    const passwordLoginStarted = new Promise<void>((resolve) => {
      markPasswordLoginStarted = resolve;
    });
    let finishPasswordLogin!: () => void;
    const passwordLoginCanFinish = new Promise<void>((resolve) => {
      finishPasswordLogin = resolve;
    });
    const passwordLogin = withAuthSessionLock(async () => {
      testRuntime.setPersistentSession(
        COMPETING_ACCESS_TOKEN,
        COMPETING_REFRESH_TOKEN,
      );
      markPasswordLoginStarted();
      await passwordLoginCanFinish;
    });
    await passwordLoginStarted;

    const deviceOutcome = consumeDeviceMagicLink(
      testRuntime.clients,
      hash(),
      "helper",
    );
    expect(testRuntime.persistentGetSession).not.toHaveBeenCalled();

    finishPasswordLogin();
    await passwordLogin;
    await expect(deviceOutcome).resolves.toBe("unavailable");
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.persistentSession()).toEqual({
      access_token: COMPETING_ACCESS_TOKEN,
      refresh_token: COMPETING_REFRESH_TOKEN,
    });
  });

  it("fails closed when cross-tab locking is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const testRuntime = runtime();

    await expect(
      consumeDeviceMagicLink(testRuntime.clients, hash(), "helper"),
    ).resolves.toBe("unavailable");
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
    expect(testRuntime.persistentGetSession).not.toHaveBeenCalled();
    expect(testRuntime.setSession).not.toHaveBeenCalled();
    expect(testRuntime.verificationSignOut).not.toHaveBeenCalled();
    expect(testRuntime.verificationDispose).not.toHaveBeenCalled();
    expect(testRuntime.persistentDispose).not.toHaveBeenCalled();
    expect(testRuntime.createPersistentClient).not.toHaveBeenCalled();
    expect(testRuntime.createVerificationClient).not.toHaveBeenCalled();
  });

  it("times out only while waiting for the device lock and does not consume the token", async () => {
    vi.useFakeTimers();
    const request = vi.fn(
      (
        _name: string,
        options: LockOptions,
      ) =>
        new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const testRuntime = runtime();

    const outcome = consumeDeviceMagicLink(
      testRuntime.clients,
      hash(),
      "helper",
    );
    const assertion = expect(outcome).resolves.toBe("unavailable");
    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
    expect(testRuntime.verifyOtp).not.toHaveBeenCalled();
    expect(testRuntime.persistentGetSession).not.toHaveBeenCalled();
    expect(testRuntime.verificationDispose).not.toHaveBeenCalled();
    expect(testRuntime.persistentDispose).not.toHaveBeenCalled();
    expect(testRuntime.createPersistentClient).not.toHaveBeenCalled();
    expect(testRuntime.createVerificationClient).not.toHaveBeenCalled();
  });
});
