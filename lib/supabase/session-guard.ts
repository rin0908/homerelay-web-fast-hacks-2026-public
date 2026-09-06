export const SESSION_GUARD_COOKIE_NAME = "homerelay-session-guard-v1";

const ACTIVE_PREFIX = "v1:active:";
const SIGNED_OUT_VALUE = "v1:signed-out";
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export type SessionGuard =
  | { state: "absent" }
  | { state: "active"; fingerprint: string }
  | { state: "signed-out" };

export const SESSION_GUARD_COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
  priority: "high" as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export function readSessionGuard(value: string | undefined): SessionGuard {
  if (value === undefined) return { state: "absent" };
  if (value === SIGNED_OUT_VALUE) return { state: "signed-out" };

  if (value.startsWith(ACTIVE_PREFIX)) {
    const fingerprint = value.slice(ACTIVE_PREFIX.length);
    if (FINGERPRINT_PATTERN.test(fingerprint)) {
      return { state: "active", fingerprint };
    }
  }

  // A present but malformed guard must never downgrade to legacy mode.
  return { state: "signed-out" };
}

export function signedOutSessionGuardValue(): string {
  return SIGNED_OUT_VALUE;
}

export function sessionIdFromClaims(claims: unknown): string | null {
  if (!claims || typeof claims !== "object") return null;
  const sessionId = (claims as { session_id?: unknown }).session_id;
  return typeof sessionId === "string" && SESSION_ID_PATTERN.test(sessionId)
    ? sessionId
    : null;
}

export async function fingerprintSessionId(
  sessionId: string,
): Promise<string | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sessionId),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function activeSessionGuardValue(
  sessionId: string,
): Promise<string | null> {
  const fingerprint = await fingerprintSessionId(sessionId);
  return fingerprint ? `${ACTIVE_PREFIX}${fingerprint}` : null;
}

export async function sessionGuardAllows(
  guard: SessionGuard,
  sessionId: string | null,
): Promise<boolean> {
  if (guard.state === "absent") return true;
  if (guard.state !== "active" || !sessionId) return false;
  const fingerprint = await fingerprintSessionId(sessionId);
  return fingerprint !== null && fingerprint === guard.fingerprint;
}

export function homeRelayAuthCookieNamePrefix(
  supabaseUrl: string,
): string | null {
  try {
    const hostname = new URL(supabaseUrl).hostname;
    const projectReference = hostname.split(".")[0];
    return projectReference && /^[a-z0-9-]+$/i.test(projectReference)
      ? `sb-${projectReference}-auth-token`
      : null;
  } catch {
    return null;
  }
}

export function isHomeRelayAuthCookieName(
  name: string,
  supabaseUrl: string,
): boolean {
  const prefix = homeRelayAuthCookieNamePrefix(supabaseUrl);
  return Boolean(
    prefix &&
      (name === prefix ||
        name.startsWith(`${prefix}.`) ||
        name.startsWith(`${prefix}-`)),
  );
}
