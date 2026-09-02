import type { Session, SupabaseClient } from "@supabase/supabase-js";

import {
  supportsAuthSessionLock,
  withAuthSessionLock,
} from "@/lib/supabase/auth-session-lock";

export type DeviceLoginOutcome =
  | "invalid"
  | "membership"
  | "success"
  | "unavailable";

export type DeviceLoginRole = "family" | "helper";

type MemberRow = {
  auth_user_id: unknown;
  id: unknown;
  role: unknown;
};

type DeviceLoginClientFactories = Readonly<{
  completePersistentSession?: (verification: {
    authUserId: string;
    expectedRole: DeviceLoginRole;
  }) => Promise<boolean>;
  createPersistentClient: () => SupabaseClient | null;
  createVerificationClient: () => SupabaseClient | null;
  preparePersistentSession?: () => Promise<boolean>;
}>;

type SessionCredentials = Pick<Session, "access_token" | "refresh_token">;

type VerificationResult =
  | {
      outcome: "verified";
      authUserId: string;
      session: SessionCredentials;
    }
  | {
      outcome: Exclude<DeviceLoginOutcome, "success">;
    };

const DEVICE_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;

function tokenFromHash(hash: string): string | null {
  if (!hash.startsWith("#") || hash.length > 1_024) return null;

  const parameters = new URLSearchParams(hash.slice(1));
  if (
    parameters.getAll("token_hash").length !== 1 ||
    parameters.getAll("type").length !== 1 ||
    parameters.get("type") !== "magiclink" ||
    [...parameters.keys()].some(
      (key) => key !== "token_hash" && key !== "type",
    )
  ) {
    return null;
  }

  const tokenHash = parameters.get("token_hash");
  return tokenHash && /^[A-Za-z0-9_-]{32,512}$/.test(tokenHash)
    ? tokenHash
    : null;
}

async function authenticateDeviceMagicLink(
  verificationClient: SupabaseClient,
  hash: string,
  expectedRole: DeviceLoginRole,
  observeVerification: () => void,
): Promise<VerificationResult> {
  const tokenHash = tokenFromHash(hash);
  if (!tokenHash) {
    return { outcome: "invalid" };
  }

  observeVerification();
  const verification = await verificationClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verification.error) {
    return { outcome: "invalid" };
  }
  const verifiedSession = verification.data.session;
  const accessToken = verifiedSession?.access_token;
  const refreshToken = verifiedSession?.refresh_token;
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    typeof refreshToken !== "string" ||
    !refreshToken
  ) {
    return { outcome: "unavailable" };
  }
  const claims = await verificationClient.auth.getClaims();
  const authUserId = claims.data?.claims?.sub;
  if (claims.error || typeof authUserId !== "string" || !authUserId) {
    return { outcome: "membership" };
  }

  const membershipOperation = verificationClient
    .from("members")
    .select("id, auth_user_id, role")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  const membership = await membershipOperation;
  const member = membership.data as MemberRow | null;
  if (
    membership.error ||
    !member ||
    typeof member.id !== "string" ||
    member.auth_user_id !== authUserId ||
    member.role !== expectedRole
  ) {
    return { outcome: "membership" };
  }

  return {
    outcome: "verified",
    authUserId,
    session: { access_token: accessToken, refresh_token: refreshToken },
  };
}

type PersistentSessionRead =
  | { ok: true; session: Session | null }
  | { ok: false };

async function readPersistentSession(
  persistentClient: SupabaseClient,
): Promise<PersistentSessionRead> {
  try {
    const current = await persistentClient.auth.getSession();
    if (current.error) return { ok: false };
    return {
      ok: true,
      session: current.data.session,
    };
  } catch {
    return { ok: false };
  }
}

function sessionsMatch(
  current: SessionCredentials | null,
  candidate: SessionCredentials,
): boolean {
  return (
    current?.access_token === candidate.access_token &&
    current.refresh_token === candidate.refresh_token
  );
}

async function persistentSessionMatches(
  persistentClient: SupabaseClient,
  session: SessionCredentials,
): Promise<boolean> {
  const current = await readPersistentSession(persistentClient);
  return current.ok && sessionsMatch(current.session, session);
}

async function removeFailedCandidateSession(
  persistentClient: SupabaseClient,
  session: SessionCredentials,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await readPersistentSession(persistentClient);
    if (!before.ok) return false;
    if (!sessionsMatch(before.session, session)) return true;

    try {
      // The shared lock is still held here, so a cooperating HomeRelay login
      // cannot be replaced between the token check and this local cleanup.
      await persistentClient.auth.signOut({ scope: "local" });
    } catch {
      // SDK sign-out errors can still follow successful local storage removal.
      // Read back before deciding whether one bounded retry is necessary.
    }
  }

  const after = await readPersistentSession(persistentClient);
  return after.ok && !sessionsMatch(after.session, session);
}

async function persistVerifiedSession(
  persistentClient: SupabaseClient,
  session: SessionCredentials,
  authUserId: string,
): Promise<boolean> {
  const current = await readPersistentSession(persistentClient);
  if (!current.ok) return false;
  if (current.session) {
    return sessionsMatch(current.session, session);
  }

  try {
    // The dedicated transfer client's fetch aborts the underlying request.
    // Await it while the caller retains the shared auth lock; abandoning an
    // in-flight setSession would permit a late cookie write after lock release.
    const result = await persistentClient.auth.setSession(session);
    const persistedSession = credentialsFromSession(result.data.session);
    if (!result.error && persistedSession) {
      if (await persistentSessionMatches(persistentClient, persistedSession)) {
        return true;
      }
      await removeFailedCandidateSession(persistentClient, persistedSession);
      return false;
    }

    await removeFailedCandidateSession(persistentClient, session);
    return false;
  } catch {
    // Supabase saves before notifying subscribers. If notification alone
    // threw, a refresh may already have rotated both tokens. Accept only the
    // exact candidate or a rotated session carrying the already-verified user
    // id; never mistake another user's non-cooperating login for our transfer.
    const persisted = await readPersistentSession(persistentClient);
    if (persisted.ok && persisted.session) {
      if (sessionsMatch(persisted.session, session)) return true;
      if (
        credentialsFromSession(persisted.session) &&
        persisted.session.user?.id === authUserId
      ) {
        return true;
      }
    }

    await removeFailedCandidateSession(persistentClient, session);
    return false;
  }
}

function credentialsFromSession(
  session: Session | null,
): SessionCredentials | null {
  const accessToken = session?.access_token;
  const refreshToken = session?.refresh_token;
  return typeof accessToken === "string" &&
    accessToken &&
    typeof refreshToken === "string" &&
    refreshToken
    ? { access_token: accessToken, refresh_token: refreshToken }
    : null;
}

async function disposeEphemeralClient(
  verificationClient: SupabaseClient,
): Promise<void> {
  try {
    await verificationClient.auth.dispose();
  } catch {
    // The client owns no browser storage, so dropping the last reference still
    // leaves no persistent credentials even if lifecycle cleanup reports an error.
  }
}

async function revokeAndDisposeEphemeralSession(
  verificationClient: SupabaseClient,
): Promise<void> {
  try {
    await verificationClient.auth.signOut({ scope: "local" });
  } catch {
    // This persistSession:false client cannot alter another tab's session.
  } finally {
    await disposeEphemeralClient(verificationClient);
  }
}

async function disposePersistentClient(
  persistentClient: SupabaseClient,
): Promise<void> {
  try {
    await persistentClient.auth.dispose();
  } catch {
    // The dedicated client is no longer referenced and owns no background
    // work required by the application singleton.
  }
}

async function consumeDeviceMagicLinkWhileLocked(
  { persistentClient, verificationClient }: {
    persistentClient: SupabaseClient;
    verificationClient: SupabaseClient;
  },
  hash: string,
  expectedRole: DeviceLoginRole,
  completePersistentSession?: DeviceLoginClientFactories["completePersistentSession"],
): Promise<DeviceLoginOutcome> {
  let verificationStarted = false;
  let outcome: DeviceLoginOutcome = "unavailable";

  try {
    // Validate locally first, then refuse to consume a one-time token when
    // this browser already has any session. This is the first half of the
    // compare-and-set guard; persistVerifiedSession reads again immediately
    // before the cookie write to catch non-cooperating/native auth changes.
    if (!tokenFromHash(hash)) {
      outcome = "invalid";
      return outcome;
    }
    const initial = await readPersistentSession(persistentClient);
    if (!initial.ok || initial.session) return outcome;

    const verification = await authenticateDeviceMagicLink(
      verificationClient,
      hash,
      expectedRole,
      () => {
        verificationStarted = true;
      },
    );
    if (verification.outcome !== "verified") {
      outcome = verification.outcome;
      return outcome;
    }

    const persisted = await persistVerifiedSession(
      persistentClient,
      verification.session,
      verification.authUserId,
    );
    if (!persisted) return outcome;

    if (completePersistentSession) {
      const completed = await completePersistentSession({
        authUserId: verification.authUserId,
        expectedRole,
      });
      if (!completed) return outcome;
    }

    outcome = "success";
    return outcome;
  } catch {
    return outcome;
  } finally {
    if (outcome === "success" || !verificationStarted) {
      // signOut({ scope: "local" }) revokes the refresh token server-side.
      // After a successful transfer that same token backs the persistent
      // session, so dispose listeners/background work and release this
      // persistSession:false client's private in-memory store to GC instead.
      await disposeEphemeralClient(verificationClient);
    } else {
      // verifyOtp can save a session and then reject (for example, if a
      // subscriber fails). A best-effort sign-out is therefore required after
      // every unsuccessful verification attempt, not only after a resolved
      // response exposed session credentials.
      await revokeAndDisposeEphemeralSession(verificationClient);
    }
    await disposePersistentClient(persistentClient);
  }
}

export async function consumeDeviceMagicLink(
  factories: DeviceLoginClientFactories,
  hash: string,
  expectedRole: DeviceLoginRole,
): Promise<DeviceLoginOutcome> {
  if (!tokenFromHash(hash)) return "invalid";
  if (!supportsAuthSessionLock()) return "unavailable";

  try {
    // Verification, membership lookup, cookie transfer, and all cleanup form
    // one ordered auth operation. Other HomeRelay tabs can neither log in nor
    // log out between these stages.
    return await withAuthSessionLock(
      async () => {
        if (factories.preparePersistentSession) {
          try {
            if (!(await factories.preparePersistentSession())) {
              return "unavailable";
            }
          } catch {
            return "unavailable";
          }
        }

        // Client construction can initialize cookie-backed Auth state. Keep it
        // inside the same critical section as verification and transfer.
        // Build the memory-only verifier first. If the cookie-backed factory
        // then fails, no partially initialized persistent client can leave an
        // in-flight cookie refresh behind after this lock is released.
        let verificationClient: SupabaseClient | null;
        try {
          verificationClient = factories.createVerificationClient();
        } catch {
          return "unavailable";
        }
        if (!verificationClient) return "unavailable";

        let persistentClient: SupabaseClient | null;
        try {
          persistentClient = factories.createPersistentClient();
        } catch {
          await disposeEphemeralClient(verificationClient);
          return "unavailable";
        }
        if (!persistentClient) {
          await disposeEphemeralClient(verificationClient);
          return "unavailable";
        }
        return consumeDeviceMagicLinkWhileLocked(
          { persistentClient, verificationClient },
          hash,
          expectedRole,
          factories.completePersistentSession,
        );
      },
      { acquireTimeoutMs: DEVICE_LOCK_ACQUIRE_TIMEOUT_MS },
    );
  } catch {
    return "unavailable";
  }
}
