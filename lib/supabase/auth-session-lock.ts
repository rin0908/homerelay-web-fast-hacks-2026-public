const AUTH_SESSION_LOCK_NAME = "homerelay:auth-session";

type AuthSessionOperation<T> = () => Promise<T>;

export class AuthSessionLockUnavailableError extends Error {
  constructor() {
    super("auth_session_lock_unavailable");
    this.name = "AuthSessionLockUnavailableError";
  }
}

export class AuthSessionLockAcquireTimeoutError extends Error {
  constructor() {
    super("auth_session_lock_acquire_timeout");
    this.name = "AuthSessionLockAcquireTimeoutError";
  }
}

export function supportsAuthSessionLock(): boolean {
  return (
    typeof globalThis.navigator !== "undefined" &&
    typeof globalThis.navigator.locks?.request === "function"
  );
}

export async function withAuthSessionLock<T>(
  operation: AuthSessionOperation<T>,
  options: Readonly<{ acquireTimeoutMs?: number }> = {},
): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager || typeof lockManager.request !== "function") {
    throw new AuthSessionLockUnavailableError();
  }

  const acquireTimeoutMs = options.acquireTimeoutMs;
  if (
    acquireTimeoutMs !== undefined &&
    (!Number.isFinite(acquireTimeoutMs) || acquireTimeoutMs <= 0)
  ) {
    throw new RangeError("auth_session_lock_timeout_invalid");
  }

  const abortController =
    acquireTimeoutMs === undefined ? null : new AbortController();
  let acquired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (abortController && acquireTimeoutMs !== undefined) {
    timer = setTimeout(() => abortController.abort(), acquireTimeoutMs);
  }

  try {
    return await lockManager.request(
      AUTH_SESSION_LOCK_NAME,
      {
        mode: "exclusive",
        ...(abortController ? { signal: abortController.signal } : {}),
      },
      async () => {
        acquired = true;
        if (timer) clearTimeout(timer);
        timer = undefined;

        // The timer controls only time spent waiting to acquire the lock.
        // Once an auth operation starts, await it fully so no late mutation can
        // escape the critical section and overwrite a newer session.
        return operation();
      },
    );
  } catch (error) {
    if (!acquired && abortController?.signal.aborted) {
      throw new AuthSessionLockAcquireTimeoutError();
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
