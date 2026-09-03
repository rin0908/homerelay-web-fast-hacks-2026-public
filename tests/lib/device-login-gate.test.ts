import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createClient, getClaims, getCurrentSession, notFound, redirect } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  getCurrentSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("synthetic_not_found");
  }),
  redirect: vi.fn(() => {
    throw new Error("synthetic_redirect");
  }),
}));

vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/session", () => ({ getCurrentSession }));

import {
  assertDeviceLoginAvailable,
  redirectAuthenticatedDeviceLogin,
} from "@/lib/device-login-gate";

beforeEach(() => {
  createClient.mockReset();
  getClaims.mockReset();
  getCurrentSession.mockReset();
  notFound.mockClear();
  redirect.mockClear();
  getClaims.mockResolvedValue({ data: null, error: null });
  createClient.mockResolvedValue({ auth: { getClaims } });
});

afterEach(() => {
  vi.unstubAllEnvs();
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
    getClaims.mockResolvedValue({
      data: { claims: { sub: "synthetic-user" } },
      error: null,
    });
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

  it.each(["error result", "thrown error"])(
    "fails closed when verified claims return an %s",
    async (failureMode) => {
      if (failureMode === "error result") {
        getClaims.mockResolvedValue({
          data: null,
          error: new Error("synthetic claims error"),
        });
      } else {
        getClaims.mockRejectedValue(new Error("synthetic claims failure"));
      }

      await expect(redirectAuthenticatedDeviceLogin()).rejects.toThrow(
        "synthetic_not_found",
      );
      expect(getCurrentSession).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("fails closed when verified Auth cannot resolve a current member", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "synthetic-user" } },
      error: null,
    });
    getCurrentSession.mockResolvedValue(null);

    await expect(redirectAuthenticatedDeviceLogin()).rejects.toThrow(
      "synthetic_not_found",
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
