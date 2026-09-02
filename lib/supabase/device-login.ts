import type { SupabaseClient } from "@supabase/supabase-js";

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

const DEVICE_LOGIN_TIMEOUT_MS = 15_000;
const DEVICE_LOGIN_TIMEOUT = Symbol("device_login_timeout");

async function withDeviceLoginTimeout<T>(
  operation: PromiseLike<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(DEVICE_LOGIN_TIMEOUT),
          DEVICE_LOGIN_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

async function localSessionIsRemoved(
  supabase: SupabaseClient,
): Promise<boolean> {
  try {
    const current = await supabase.auth.getSession();
    return !current.error && current.data.session === null;
  } catch {
    return false;
  }
}

async function localSignOut(supabase: SupabaseClient): Promise<boolean> {
  // createBrowserClient persists the session in cookies. signOut is the
  // supported way to clear that storage, and an Auth API error can still be
  // returned after the SDK has removed the local session. Verify the stored
  // state instead of either ignoring the error or assuming it left a session.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let signOutError: unknown = null;
    try {
      const result = await supabase.auth.signOut({ scope: "local" });
      signOutError = result.error;
    } catch (error) {
      signOutError = error;
    }

    if (await localSessionIsRemoved(supabase)) return true;
    if (signOutError !== null) continue;
    // A successful response with a retained cookie is inconsistent but not
    // safe. Retry through the same supported SDK path once before failing.
  }

  return false;
}

async function rejectAfterLocalSignOut(
  supabase: SupabaseClient,
  outcome: Exclude<DeviceLoginOutcome, "success" | "unavailable">,
): Promise<DeviceLoginOutcome> {
  return (await localSignOut(supabase)) ? outcome : "unavailable";
}

async function authenticateDeviceMagicLink(
  supabase: SupabaseClient,
  hash: string,
  expectedRole: DeviceLoginRole,
): Promise<DeviceLoginOutcome> {
  const tokenHash = tokenFromHash(hash);
  if (!tokenHash) {
    return rejectAfterLocalSignOut(supabase, "invalid");
  }

  const verificationOperation = supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  let verification: Awaited<typeof verificationOperation>;
  try {
    verification = await withDeviceLoginTimeout(verificationOperation);
  } catch (error) {
    if (error === DEVICE_LOGIN_TIMEOUT) {
      // verifyOtp may persist a session after our timeout because Auth does
      // not expose a per-call AbortSignal. Remove that late session as soon
      // as the original request settles.
      void verificationOperation.then(
        () => localSignOut(supabase),
        () => localSignOut(supabase),
      );
    }
    throw error;
  }
  if (verification.error) {
    return rejectAfterLocalSignOut(supabase, "invalid");
  }

  const claims = await withDeviceLoginTimeout(supabase.auth.getClaims());
  const authUserId = claims.data?.claims?.sub;
  if (claims.error || typeof authUserId !== "string" || !authUserId) {
    return rejectAfterLocalSignOut(supabase, "membership");
  }

  const membershipOperation = supabase
    .from("members")
    .select("id, auth_user_id, role")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  const membership = await withDeviceLoginTimeout(membershipOperation);
  const member = membership.data as MemberRow | null;
  if (
    membership.error ||
    !member ||
    typeof member.id !== "string" ||
    member.auth_user_id !== authUserId ||
    member.role !== expectedRole
  ) {
    return rejectAfterLocalSignOut(supabase, "membership");
  }

  return "success";
}

export async function consumeDeviceMagicLink(
  supabase: SupabaseClient,
  hash: string,
  expectedRole: DeviceLoginRole,
): Promise<DeviceLoginOutcome> {
  const authentication = authenticateDeviceMagicLink(
    supabase,
    hash,
    expectedRole,
  );

  try {
    return await authentication;
  } catch (error) {
    if (error === DEVICE_LOGIN_TIMEOUT) {
      // Claims and membership timeouts happen after verification has created
      // a session; verification timeouts also need an immediate best-effort
      // clear in addition to the late-settlement cleanup above.
      void localSignOut(supabase);
    } else {
      await localSignOut(supabase);
    }
    return "unavailable";
  }
}
