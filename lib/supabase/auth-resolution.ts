import { sessionIdFromClaims } from "@/lib/supabase/session-guard";

export type VerifiedClaims = {
  claims: Record<string, unknown>;
  sessionId: string;
  userId: string;
};

export type ClaimsResolution =
  | { state: "indeterminate" | "unauthenticated" }
  | { state: "verified"; value: VerifiedClaims };

const TERMINAL_AUTH_ERROR_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
  "refresh_token_already_used",
  "refresh_token_not_found",
  "session_expired",
  "session_not_found",
  "user_banned",
  "user_not_found",
]);

const TERMINAL_AUTH_ERROR_NAMES = new Set([
  "AuthInvalidJwtError",
  "AuthSessionMissingError",
]);

type AuthErrorShape = {
  code?: unknown;
  name?: unknown;
  status?: unknown;
};

function authErrorShape(error: unknown): AuthErrorShape | null {
  return error && typeof error === "object"
    ? (error as AuthErrorShape)
    : null;
}

export function isClearlyUnauthenticatedAuthError(error: unknown): boolean {
  const candidate = authErrorShape(error);
  if (!candidate) return false;
  const status =
    typeof candidate.status === "number" ? candidate.status : undefined;

  // A status alone is not a stable proof that a session ended: gateways and
  // SDK wrappers can return the same status for unrelated failures. Only
  // documented Auth names/codes are terminal; unknowns remain recoverable.
  if (status === 0 || status === 429 || (status !== undefined && status >= 500)) {
    return false;
  }
  return (
    (typeof candidate.code === "string" &&
      TERMINAL_AUTH_ERROR_CODES.has(candidate.code)) ||
    (typeof candidate.name === "string" &&
      TERMINAL_AUTH_ERROR_NAMES.has(candidate.name))
  );
}

export function classifyClaimsResult(result: {
  data?: { claims?: unknown } | null;
  error?: unknown;
}): ClaimsResolution {
  if (result.error) {
    return {
      state: isClearlyUnauthenticatedAuthError(result.error)
        ? "unauthenticated"
        : "indeterminate",
    };
  }

  // auth-js 2.112.4 deliberately returns this exact shape when getSession()
  // finds no current session. Undefined/malformed data is not equivalent.
  if (result.data === null && result.error === null) {
    return { state: "unauthenticated" };
  }

  const claims = result.data?.claims;
  if (!claims || typeof claims !== "object") {
    return { state: "indeterminate" };
  }
  const userId = (claims as { sub?: unknown }).sub;
  const sessionId = sessionIdFromClaims(claims);
  if (typeof userId !== "string" || !userId || !sessionId) {
    return { state: "indeterminate" };
  }
  return {
    state: "verified",
    value: {
      claims: claims as Record<string, unknown>,
      sessionId,
      userId,
    },
  };
}

export function isClearlyInvalidOrExpiredOtpError(error: unknown): boolean {
  const candidate = authErrorShape(error);
  if (!candidate) return false;
  const status =
    typeof candidate.status === "number" ? candidate.status : undefined;

  // Supabase Auth currently uses otp_expired for an expired or invalid
  // one-time token. All unrecognized responses remain availability failures.
  return (
    status !== 429 &&
    (status === undefined || status < 500) &&
    candidate.code === "otp_expired"
  );
}
