import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  getSupabasePublicConfig: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: mocks.getSupabasePublicConfig,
}));

describe("Supabase browser client", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createBrowserClient.mockReset();
    mocks.getSupabasePublicConfig.mockReset();
  });

  it("returns null without public configuration", async () => {
    mocks.getSupabasePublicConfig.mockReturnValue(null);
    const { createClient } = await import("@/lib/supabase/client");

    expect(createClient()).toBeNull();
    expect(mocks.createBrowserClient).not.toHaveBeenCalled();
  });

  it("creates one browser client with the publishable key", async () => {
    const client = { synthetic: true };
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.createBrowserClient.mockReturnValue(client);
    const { createClient } = await import("@/lib/supabase/client");

    expect(createClient()).toBe(client);
    expect(createClient()).toBe(client);
    expect(mocks.createBrowserClient).toHaveBeenCalledOnce();
    expect(mocks.createBrowserClient).toHaveBeenCalledWith(
      "https://synthetic.supabase.co",
      "sb_publishable_synthetic",
    );
  });
});
