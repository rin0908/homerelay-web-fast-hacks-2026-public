import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentSession: vi.fn(),
  redirect: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

import { login } from "@/app/login/actions";

function form(email = "invited@example.test", password = "synthetic-password") {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

describe("invited member login action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getCurrentSession.mockResolvedValue({
      member: { id: "synthetic-member" },
      userId: "synthetic-user",
    });
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
        signOut: mocks.signOut,
      },
    } as unknown as SupabaseClient);
  });

  it("rejects invalid input before creating a client", async () => {
    await expect(login(form("not-an-email", ""))).rejects.toThrow(
      "REDIRECT:/login?error=invalid",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps demo or missing-environment mode available", async () => {
    mocks.createClient.mockResolvedValue(null);

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=unavailable",
    );
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("uses password sign-in and redirects an invited member home", async () => {
    await expect(login(form())).rejects.toThrow("REDIRECT:/");

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "invited@example.test",
      password: "synthetic-password",
    });
    expect(mocks.getCurrentSession).toHaveBeenCalledOnce();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("returns a generic credential error without exposing provider details", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: new Error("synthetic provider detail"),
    });

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=invalid",
    );
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("signs out an authenticated user who has no RLS-visible membership", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);

    await expect(login(form())).rejects.toThrow(
      "REDIRECT:/login?error=membership",
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
