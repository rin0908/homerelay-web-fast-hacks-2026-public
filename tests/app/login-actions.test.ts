import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieGetAll: vi.fn(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  createClient: vi.fn(),
  existingMaybeSingle: vi.fn(),
  getClaims: vi.fn(),
  getCurrentSession: vi.fn(),
  getSession: vi.fn(),
  getSupabasePublicConfig: vi.fn(),
  redirect: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: mocks.getSupabasePublicConfig,
}));

import { login } from "@/app/login/actions";
import {
  activeSessionGuardValue,
  readSessionGuard,
  SESSION_GUARD_COOKIE_NAME,
  signedOutSessionGuardValue,
} from "@/lib/supabase/session-guard";

const AUTH_USER_ID = "synthetic-invited-user";
const OTHER_USER_ID = "synthetic-other-user";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";

function form(email = "invited@example.test", password = "synthetic-password") {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

function noSessionClaims() {
  return { data: null, error: null };
}

function claims(userId = AUTH_USER_ID, sessionId = SESSION_ID) {
  return { data: { claims: { session_id: sessionId, sub: userId } }, error: null };
}

describe("invited member login action", () => {
  let cookieValues: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClaims.mockReset();
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });
    cookieValues = new Map();
    mocks.cookieGet.mockImplementation((name: string) => {
      const value = cookieValues.get(name);
      return value === undefined ? undefined : { name, value };
    });
    mocks.cookieGetAll.mockImplementation(() =>
      [...cookieValues].map(([name, value]) => ({ name, value })),
    );
    mocks.cookieSet.mockImplementation((name: string, value: string) => {
      cookieValues.set(name, value);
    });
    mocks.cookies.mockResolvedValue({
      get: mocks.cookieGet,
      getAll: mocks.cookieGetAll,
      set: mocks.cookieSet,
    });
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: AUTH_USER_ID } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.getClaims
      .mockResolvedValueOnce(noSessionClaims())
      .mockResolvedValue(claims());
    mocks.getCurrentSession.mockResolvedValue({
      member: { id: "synthetic-member", role: "family" },
      sessionId: SESSION_ID,
      userId: AUTH_USER_ID,
    });
    mocks.existingMaybeSingle.mockResolvedValue({
      data: { auth_user_id: AUTH_USER_ID, role: "family" },
      error: null,
    });
    const eq = vi.fn(() => ({ maybeSingle: mocks.existingMaybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: mocks.getClaims,
        getSession: mocks.getSession,
        signInWithPassword: mocks.signInWithPassword,
        signOut: mocks.signOut,
      },
      from: vi.fn(() => ({ select })),
    } as unknown as SupabaseClient);
  });

  it("rejects invalid input before reading cookies or creating a client", async () => {
    await expect(login(form("not-an-email", ""))).rejects.toThrow(
      "REDIRECT:/login?error=invalid",
    );
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("writes an active guard bound to the exact successful login session", async () => {
    await expect(login(form())).rejects.toThrow("REDIRECT:/");

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "invited@example.test",
      password: "synthetic-password",
    });
    expect(mocks.getCurrentSession).toHaveBeenCalledOnce();
    expect(readSessionGuard(cookieValues.get(SESSION_GUARD_COOKIE_NAME)).state).toBe(
      "active",
    );
  });

  it("returns home when an existing guarded user still has membership", async () => {
    const guard = await activeSessionGuardValue(SESSION_ID);
    cookieValues.set(SESSION_GUARD_COOKIE_NAME, guard!);
    mocks.getClaims.mockReset().mockResolvedValue(claims());

    await expect(login(form())).rejects.toThrow("REDIRECT:/");

    expect(mocks.existingMaybeSingle).toHaveBeenCalledOnce();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("clears a membership-deleted session with read-back before relogin", async () => {
    mocks.getClaims
      .mockReset()
      .mockResolvedValueOnce(claims())
      .mockResolvedValue(claims());
    mocks.existingMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(login(form())).rejects.toThrow("REDIRECT:/");

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
  });

  it("does not overwrite an existing session when membership lookup is unavailable", async () => {
    mocks.getClaims.mockReset().mockResolvedValue(claims());
    mocks.existingMaybeSingle.mockResolvedValue({
      data: null,
      error: new Error("synthetic database outage"),
    });

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=unavailable",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("fails closed when deleted-session cleanup cannot be read back", async () => {
    mocks.getClaims.mockReset().mockResolvedValue(claims());
    mocks.existingMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "still-present" } },
      error: null,
    });

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=unavailable",
    );
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("ignores a late auth cookie when signed-out and activates only the new login", async () => {
    cookieValues.set(
      SESSION_GUARD_COOKIE_NAME,
      signedOutSessionGuardValue(),
    );
    cookieValues.set("sb-synthetic-auth-token", "late-old-session");
    cookieValues.set("sb-other-auth-token", "keep-other-project");
    mocks.getClaims.mockReset().mockResolvedValue(claims());

    await expect(login(form())).rejects.toThrow("REDIRECT:/");

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
    expect(cookieValues.get("sb-synthetic-auth-token")).toBe("");
    expect(cookieValues.get("sb-other-auth-token")).toBe("keep-other-project");
    expect(readSessionGuard(cookieValues.get(SESSION_GUARD_COOKIE_NAME)).state).toBe(
      "active",
    );
  });

  it("rejects another user appearing between membership and final claims", async () => {
    mocks.getClaims
      .mockReset()
      .mockResolvedValueOnce(noSessionClaims())
      .mockResolvedValue(claims(OTHER_USER_ID, OTHER_SESSION_ID));

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=unavailable",
    );

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(cookieValues.get(SESSION_GUARD_COOKIE_NAME)).toBe(
      signedOutSessionGuardValue(),
    );
  });

  it("rejects a successful sign-in that lacks session_id", async () => {
    mocks.getClaims
      .mockReset()
      .mockResolvedValueOnce(noSessionClaims())
      .mockResolvedValue({ data: { claims: { sub: AUTH_USER_ID } }, error: null });

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=unavailable",
    );
    expect(cookieValues.get(SESSION_GUARD_COOKIE_NAME)).toBe(
      signedOutSessionGuardValue(),
    );
  });

  it("reports missing post-login membership and leaves signed-out", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=membership",
    );
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(cookieValues.get(SESSION_GUARD_COOKIE_NAME)).toBe(
      signedOutSessionGuardValue(),
    );
  });

  it("keeps demo or missing-environment mode unavailable", async () => {
    mocks.getSupabasePublicConfig.mockReturnValue(null);
    mocks.createClient.mockResolvedValue(null);

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=unavailable",
    );
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
});
