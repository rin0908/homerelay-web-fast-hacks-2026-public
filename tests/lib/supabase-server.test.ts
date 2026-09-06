import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGetAll: vi.fn(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  getSupabasePublicConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: mocks.getSupabasePublicConfig,
}));

import { createClient } from "@/lib/supabase/server";

describe("Supabase server client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({
      getAll: mocks.cookieGetAll,
      set: mocks.cookieSet,
    });
  });

  it("returns null without public configuration and does not read cookies", async () => {
    mocks.getSupabasePublicConfig.mockReturnValue(null);

    await expect(createClient()).resolves.toBeNull();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("uses getAll/setAll with the publishable key", async () => {
    const client = { synthetic: true };
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.createServerClient.mockReturnValue(client);
    mocks.cookieGetAll.mockReturnValue([{ name: "existing", value: "cookie" }]);

    await expect(createClient()).resolves.toBe(client);

    const options = mocks.createServerClient.mock.calls[0]?.[2];
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "https://synthetic.supabase.co",
      "sb_publishable_synthetic",
      expect.any(Object),
    );
    expect(options.global.fetch).toEqual(expect.any(Function));
    expect(options.cookies.getAll()).toEqual([
      { name: "existing", value: "cookie" },
    ]);

    expect(() =>
      options.cookies.setAll(
        [
          {
            name: "sb-session",
            options: { httpOnly: true, path: "/" },
            value: "synthetic-session",
          },
        ],
        {},
      ),
    ).not.toThrow();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "sb-session",
      "synthetic-session",
      { httpOnly: true, path: "/" },
    );
  });

  it("does not throw when a Server Component cannot write cookies", async () => {
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.createServerClient.mockReturnValue({ synthetic: true });
    mocks.cookieSet.mockImplementation(() => {
      throw new Error("read-only cookie store");
    });

    await createClient();
    const options = mocks.createServerClient.mock.calls[0]?.[2];

    expect(() =>
      options.cookies.setAll(
        [{ name: "sb-session", options: {}, value: "synthetic-session" }],
        {},
      ),
    ).not.toThrow();
  });
});
