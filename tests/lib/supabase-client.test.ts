import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  createSupabaseClient: vi.fn(),
  getSupabasePublicConfig: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createSupabaseClient,
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: mocks.getSupabasePublicConfig,
}));

describe("Supabase browser client", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createBrowserClient.mockReset();
    mocks.createSupabaseClient.mockReset();
    mocks.getSupabasePublicConfig.mockReset();
  });

  it("returns null without public configuration", async () => {
    mocks.getSupabasePublicConfig.mockReturnValue(null);
    const { createClient, createEphemeralClient, createTransferClient } = await import(
      "@/lib/supabase/client"
    );

    expect(createClient()).toBeNull();
    expect(createEphemeralClient()).toBeNull();
    expect(createTransferClient()).toBeNull();
    expect(mocks.createBrowserClient).not.toHaveBeenCalled();
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
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
      {
        auth: {
          detectSessionInUrl: false,
          lock: expect.any(Function),
          lockAcquireTimeout: -1,
        },
        global: { fetch: expect.any(Function) },
      },
    );
  });

  it("creates a fresh non-persistent client for device-link verification", async () => {
    const firstClient = { synthetic: "first" };
    const secondClient = { synthetic: "second" };
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.createSupabaseClient
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient);
    const { createEphemeralClient } = await import("@/lib/supabase/client");

    expect(createEphemeralClient()).toBe(firstClient);
    expect(createEphemeralClient()).toBe(secondClient);
    expect(mocks.createSupabaseClient).toHaveBeenCalledTimes(2);
    expect(mocks.createSupabaseClient).toHaveBeenCalledWith(
      "https://synthetic.supabase.co",
      "sb_publishable_synthetic",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
        global: { fetch: expect.any(Function) },
      },
    );
    expect(mocks.createBrowserClient).not.toHaveBeenCalled();
  });

  it("creates a fresh non-singleton cookie-backed transfer client", async () => {
    const firstClient = { synthetic: "first-transfer" };
    const secondClient = { synthetic: "second-transfer" };
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.createBrowserClient
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient);
    const { createTransferClient } = await import("@/lib/supabase/client");

    expect(createTransferClient()).toBe(firstClient);
    expect(createTransferClient()).toBe(secondClient);
    expect(mocks.createBrowserClient).toHaveBeenCalledTimes(2);
    expect(mocks.createBrowserClient).toHaveBeenCalledWith(
      "https://synthetic.supabase.co",
      "sb_publishable_synthetic",
      {
        auth: {
          lock: expect.any(Function),
          lockAcquireTimeout: -1,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: true,
          skipAutoInitialize: true,
        },
        global: { fetch: expect.any(Function) },
        isSingleton: false,
      },
    );
  });

  it("aborts the underlying Supabase request at the network deadline", async () => {
    vi.useFakeTimers();
    try {
      mocks.getSupabasePublicConfig.mockReturnValue({
        publishableKey: "sb_publishable_synthetic",
        url: "https://synthetic.supabase.co",
      });
      mocks.createSupabaseClient.mockReturnValue({ synthetic: true });
      const { createEphemeralClient } = await import("@/lib/supabase/client");
      createEphemeralClient();
      const options = mocks.createSupabaseClient.mock.calls[0]?.[2] as {
        global: { fetch: typeof fetch };
      };
      let requestSignal: AbortSignal | undefined;
      const networkFetch = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined;
            requestSignal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
      vi.stubGlobal("fetch", networkFetch);

      const request = options.global.fetch("https://synthetic.supabase.co/auth");
      const rejection = expect(request).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(15_000);

      await rejection;
      expect(requestSignal?.aborted).toBe(true);
      expect(networkFetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
