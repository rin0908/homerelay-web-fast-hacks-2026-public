import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createClient, notFound, redirect, resolveCurrentSession } = vi.hoisted(() => ({
  createClient: vi.fn(),
  resolveCurrentSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("synthetic_not_found");
  }),
  redirect: vi.fn(() => {
    throw new Error("synthetic_redirect");
  }),
}));

vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/session", () => ({ resolveCurrentSession }));

import {
  assertDeviceLoginAvailable,
  redirectAuthenticatedDeviceLogin,
} from "@/lib/device-login-gate";

beforeEach(() => {
  createClient.mockReset();
  resolveCurrentSession.mockReset();
  notFound.mockClear();
  redirect.mockClear();
  resolveCurrentSession.mockResolvedValue({ state: "unauthenticated" });
  createClient.mockResolvedValue({ synthetic: true });
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
    await expect(redirectAuthenticatedDeviceLogin()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(["throws", "returns null"] as const)(
    "fails closed when the server client factory %s",
    async (failureMode) => {
      if (failureMode === "throws") {
        createClient.mockRejectedValue(new Error("synthetic client failure"));
      } else {
        createClient.mockResolvedValue(null);
      }

      await expect(redirectAuthenticatedDeviceLogin()).rejects.toThrow(
        "synthetic_not_found",
      );
      expect(resolveCurrentSession).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("sends an already authenticated member home without consuming a QR", async () => {
    resolveCurrentSession.mockResolvedValue({
      session: {
        member: { id: "synthetic-member" },
        sessionId: "synthetic-session",
        userId: "synthetic-user",
      },
      state: "verified",
    });

    await expect(redirectAuthenticatedDeviceLogin()).rejects.toThrow(
      "synthetic_redirect",
    );
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it.each(["indeterminate", "forbidden"])(
    "fails closed for a %s session resolution",
    async (state) => {
      resolveCurrentSession.mockResolvedValue({ state });

      await expect(redirectAuthenticatedDeviceLogin()).rejects.toThrow(
        "synthetic_not_found",
      );
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the session resolver throws", async () => {
    resolveCurrentSession.mockRejectedValue(
      new Error("synthetic session failure"),
    );

    await expect(redirectAuthenticatedDeviceLogin()).rejects.toThrow(
      "synthetic_not_found",
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
