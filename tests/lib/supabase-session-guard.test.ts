import { describe, expect, it } from "vitest";

import {
  activeSessionGuardValue,
  homeRelayAuthCookieNamePrefix,
  isHomeRelayAuthCookieName,
  readSessionGuard,
  sessionGuardAllows,
  sessionIdFromClaims,
  signedOutSessionGuardValue,
} from "@/lib/supabase/session-guard";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

describe("Supabase HttpOnly session guard", () => {
  it("keeps a missing guard in legacy compatibility mode", async () => {
    const guard = readSessionGuard(undefined);
    expect(guard).toEqual({ state: "absent" });
    await expect(sessionGuardAllows(guard, SESSION_A)).resolves.toBe(true);
  });

  it("treats signed-out and malformed guard values as fail-closed", async () => {
    expect(readSessionGuard(signedOutSessionGuardValue())).toEqual({
      state: "signed-out",
    });
    expect(readSessionGuard("broken-guard")).toEqual({ state: "signed-out" });
    await expect(
      sessionGuardAllows(readSessionGuard("broken-guard"), SESSION_A),
    ).resolves.toBe(false);
  });

  it("allows only the exact fingerprinted JWT session_id", async () => {
    const value = await activeSessionGuardValue(SESSION_A);
    expect(value).toMatch(/^v1:active:[a-f0-9]{64}$/);
    const guard = readSessionGuard(value ?? undefined);

    await expect(sessionGuardAllows(guard, SESSION_A)).resolves.toBe(true);
    await expect(sessionGuardAllows(guard, SESSION_B)).resolves.toBe(false);
    await expect(sessionGuardAllows(guard, null)).resolves.toBe(false);
  });

  it("extracts only bounded session_id claim strings", () => {
    expect(sessionIdFromClaims({ session_id: SESSION_A })).toBe(SESSION_A);
    expect(sessionIdFromClaims({ session_id: "short" })).toBeNull();
    expect(sessionIdFromClaims({ session_id: 42 })).toBeNull();
  });

  it("identifies only the configured HomeRelay project's auth cookies", () => {
    const url = "https://homeproject.supabase.co";
    expect(homeRelayAuthCookieNamePrefix(url)).toBe(
      "sb-homeproject-auth-token",
    );
    expect(isHomeRelayAuthCookieName("sb-homeproject-auth-token", url)).toBe(
      true,
    );
    expect(isHomeRelayAuthCookieName("sb-homeproject-auth-token.1", url)).toBe(
      true,
    );
    expect(
      isHomeRelayAuthCookieName(
        "sb-homeproject-auth-token-code-verifier",
        url,
      ),
    ).toBe(true);
    expect(isHomeRelayAuthCookieName("sb-other-auth-token", url)).toBe(false);
    expect(isHomeRelayAuthCookieName("unrelated", url)).toBe(false);
  });
});
