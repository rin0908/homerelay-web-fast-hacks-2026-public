import { describe, expect, it } from "vitest";

import {
  classifyClaimsResult,
  isClearlyInvalidOrExpiredOtpError,
} from "@/lib/supabase/auth-resolution";

const CLAIMS = {
  session_id: "11111111-1111-4111-8111-111111111111",
  sub: "synthetic-user",
};

describe("Supabase auth outcome classification", () => {
  it("accepts only complete, recognizable claims as verified", () => {
    expect(
      classifyClaimsResult({ data: { claims: CLAIMS }, error: null }),
    ).toEqual({
      state: "verified",
      value: {
        claims: CLAIMS,
        sessionId: CLAIMS.session_id,
        userId: CLAIMS.sub,
      },
    });
  });

  it.each([
    { error: new Error("synthetic unknown SDK error"), label: "unknown" },
    { error: { status: 401 }, label: "unknown 401" },
    { error: { status: 403 }, label: "unknown 403" },
    {
      error: { code: "over_request_rate_limit", status: 429 },
      label: "rate limit",
    },
    { error: { status: 503 }, label: "provider 5xx" },
  ])("keeps $label recoverable", ({ error }) => {
    expect(classifyClaimsResult({ data: null, error })).toEqual({
      state: "indeterminate",
    });
  });

  it.each([
    { code: "session_not_found", status: 400 },
    { code: "session_expired", status: 400 },
    { code: "invalid_jwt", status: 400 },
    { name: "AuthSessionMissingError", status: 400 },
    { name: "AuthInvalidJwtError", status: 400 },
  ])("recognizes a documented terminal auth error: %o", (error) => {
    expect(classifyClaimsResult({ data: null, error })).toEqual({
      state: "unauthenticated",
    });
  });

  it("recognizes the SDK's exact no-session result", () => {
    expect(classifyClaimsResult({ data: null, error: null })).toEqual({
      state: "unauthenticated",
    });
  });

  it.each([
    { data: null },
    { data: null, error: undefined },
    { data: null, error: false },
    { data: undefined, error: null },
    { data: { claims: null }, error: null },
    { data: { claims: { sub: "synthetic-user" } }, error: null },
  ])("treats an unknown success shape as indeterminate", (result) => {
    expect(classifyClaimsResult(result)).toEqual({ state: "indeterminate" });
  });

  it("treats only Supabase's explicit otp_expired code as invalid", () => {
    expect(
      isClearlyInvalidOrExpiredOtpError({ code: "otp_expired", status: 403 }),
    ).toBe(true);
    expect(isClearlyInvalidOrExpiredOtpError({ status: 403 })).toBe(false);
    expect(
      isClearlyInvalidOrExpiredOtpError({
        code: "over_request_rate_limit",
        status: 429,
      }),
    ).toBe(false);
  });
});
