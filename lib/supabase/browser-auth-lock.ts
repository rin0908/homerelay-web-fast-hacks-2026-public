import { navigatorLock } from "@supabase/auth-js";

const SUPABASE_BROWSER_LOCK_NAME = "homerelay:supabase-auth-storage";
const APP_MUTATION_LOCK_ACQUIRE_TIMEOUT_MS = 20_000;

export async function withSupabaseBrowserAuthLock<Result>(
  _sdkLockName: string,
  sdkAcquireTimeoutMs: number,
  operation: () => Promise<Result>,
): Promise<Result> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager || typeof lockManager.request !== "function") {
    return operation();
  }

  // Preserve the SDK's immediate auto-refresh skip (0), but never let its
  // positive-timeout recovery steal a lock from an in-flight auth mutation.
  // Foreground calls wait; their network requests have their own hard abort.
  return navigatorLock(
    SUPABASE_BROWSER_LOCK_NAME,
    sdkAcquireTimeoutMs === 0 ? 0 : -1,
    operation,
  );
}

export async function withSupabaseBrowserAuthMutationLock<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager || typeof lockManager.request !== "function") {
    return operation();
  }

  const controller = new AbortController();
  let acquired = false;
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(),
    APP_MUTATION_LOCK_ACQUIRE_TIMEOUT_MS,
  );

  try {
    return await lockManager.request(
      SUPABASE_BROWSER_LOCK_NAME,
      { mode: "exclusive", signal: controller.signal },
      async (lock) => {
        if (!lock) throw new Error("supabase_browser_auth_lock_unavailable");
        acquired = true;
        if (timer) clearTimeout(timer);
        timer = undefined;
        return operation();
      },
    );
  } catch (error) {
    if (!acquired && controller.signal.aborted) {
      throw new Error("supabase_browser_auth_lock_acquire_timeout");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const SUPABASE_BROWSER_AUTH_OPTIONS = {
  lock: withSupabaseBrowserAuthLock,
  // -1 makes foreground SDK operations wait without activating the legacy
  // lock-stealing recovery path. Auto-refresh explicitly requests 0 itself.
  lockAcquireTimeout: -1,
} as const;
