import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  getSession: vi.fn(),
  getSupabasePublicConfig: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: mocks.getSupabasePublicConfig,
}));

import { updateSession } from "@/lib/supabase/proxy";

type ClientOptions = {
  cookies: {
    getAll: () => { name: string; value: string }[];
    setAll: (
      cookies: {
        name: string;
        options: Record<string, unknown>;
        value: string;
      }[],
      headers: Record<string, string>,
    ) => void;
  };
};

describe("Supabase session Proxy", () => {
  let clientOptions: ClientOptions | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientOptions = undefined;
    mocks.getSupabasePublicConfig.mockReturnValue({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      clientOptions = options;
      return {
        auth: {
          getClaims: mocks.getClaims,
          getSession: mocks.getSession,
        },
      };
    });
  });

  it("is a no-op in demo mode or without configuration", async () => {
    mocks.getSupabasePublicConfig.mockReturnValue(null);
    const request = new NextRequest("https://homerelay.test/");

    const response = await updateSession(request);

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("refreshes cookies with setAll and trusts getClaims, never getSession", async () => {
    const request = new NextRequest("https://homerelay.test/");
    mocks.getClaims.mockImplementation(async () => {
      clientOptions?.cookies.setAll(
        [
          {
            name: "sb-session",
            options: { httpOnly: true, path: "/" },
            value: "synthetic-session",
          },
        ],
        { "Cache-Control": "private, no-store" },
      );
      return { data: { claims: { sub: "synthetic-user" } }, error: null };
    });

    const response = await updateSession(request);

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(request.cookies.get("sb-session")?.value).toBe("synthetic-session");
    expect(response.cookies.get("sb-session")?.value).toBe("synthetic-session");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("redirects an unauthenticated protected request to login", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("expired") });
    const request = new NextRequest("https://homerelay.test/record?from=demo");

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/login",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["/login", "/logout", "/api/status"])(
    "keeps the public path %s available without a session",
    async (pathname) => {
      mocks.getClaims.mockResolvedValue({ data: null, error: null });

      const response = await updateSession(
        new NextRequest(`https://homerelay.test${pathname}`),
      );

      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );
});
