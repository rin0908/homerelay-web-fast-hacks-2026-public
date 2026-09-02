import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("synthetic_not_found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound }));

import { assertDeviceLoginAvailable } from "@/lib/device-login-gate";

afterEach(() => {
  vi.unstubAllEnvs();
  notFound.mockClear();
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
