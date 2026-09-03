import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getCurrentSession, notFound, redirect } = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("synthetic_not_found");
  }),
  redirect: vi.fn(() => {
    throw new Error("synthetic_redirect");
  }),
}));

vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/lib/supabase/session", () => ({ getCurrentSession }));

import {
  assertDeviceLoginAvailable,
  redirectAuthenticatedDeviceLogin,
} from "@/lib/device-login-gate";

afterEach(() => {
  vi.unstubAllEnvs();
  getCurrentSession.mockReset();
  notFound.mockClear();
  redirect.mockClear();
});

describe("assertDeviceLoginAvailable", () => {
  it("allows the device login only in Preview when running a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");

    expect(() => assertDeviceLoginAvailable()).not.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("rejects the device login in non-Preview production environments", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");

    expect(() => assertDeviceLoginAvailable()).toThrow("synthetic_not_found");
    expect(notFound).toHaveBeenCalledOnce();
  });
});

describe("redirectAuthenticatedDeviceLogin", () => {
  it("keeps an unauthenticated browser on the one-time login page", async () => {
    getCurrentSession.mockResolvedValue(null);

    await expect(redirectAuthenticatedDeviceLogin()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends an already authenticated member home without consuming a QR", async () => {
    getCurrentSession.mockResolvedValue({
      member: { id: "synthetic-member" },
      sessionId: "synthetic-session",
      userId: "synthetic-user",
    });

    await expect(redirectAuthenticatedDeviceLogin()).rejects.toThrow(
      "synthetic_redirect",
    );
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
