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
import {
  activeSessionGuardValue,
  SESSION_GUARD_COOKIE_NAME,
  signedOutSessionGuardValue,
} from "@/lib/supabase/session-guard";

type ClientOptions = {
  global: { fetch: typeof fetch };
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
      return {
        data: {
          claims: {
            session_id: "11111111-1111-4111-8111-111111111111",
            sub: "synthetic-user",
          },
        },
        error: null,
      };
    });

    const response = await updateSession(request);

    expect(clientOptions?.global.fetch).toEqual(expect.any(Function));
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(request.cookies.get("sb-session")?.value).toBe("synthetic-session");
    expect(response.cookies.get("sb-session")?.value).toBe("synthetic-session");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("releases refreshed cookies only when an active guard matches session_id", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const guard = await activeSessionGuardValue(sessionId);
    const request = new NextRequest("https://homerelay.test/", {
      headers: {
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${guard}; sb-synthetic-auth-token=old`,
      },
    });
    mocks.getClaims.mockImplementation(async () => {
      clientOptions?.cookies.setAll(
        [
          {
            name: "sb-synthetic-auth-token",
            options: { httpOnly: true, path: "/" },
            value: "refreshed",
          },
        ],
        {},
      );
      return {
        data: { claims: { session_id: sessionId, sub: "synthetic-user" } },
        error: null,
      };
    });

    const response = await updateSession(request);

    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("sb-synthetic-auth-token")?.value).toBe(
      "refreshed",
    );
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)).toBeUndefined();
  });

  it("rejects a different session_id and deletes only HomeRelay auth cookies", async () => {
    const guard = await activeSessionGuardValue(
      "11111111-1111-4111-8111-111111111111",
    );
    const request = new NextRequest("https://homerelay.test/record", {
      headers: {
        cookie: [
          `${SESSION_GUARD_COOKIE_NAME}=${guard}`,
          "sb-synthetic-auth-token=foreign-session",
          "sb-other-auth-token=keep-me",
          "unrelated=keep-me-too",
        ].join("; "),
      },
    });
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          session_id: "22222222-2222-4222-8222-222222222222",
          sub: "synthetic-user",
        },
      },
      error: null,
    });

    const response = await updateSession(request);

    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/login",
    );
    expect(response.cookies.get("sb-synthetic-auth-token")?.value).toBe("");
    expect(response.cookies.get("sb-synthetic-auth-token")?.maxAge).toBe(0);
    expect(response.cookies.get("sb-other-auth-token")).toBeUndefined();
    expect(response.cookies.get("unrelated")).toBeUndefined();
    expect(response.cookies.get(SESSION_GUARD_COOKIE_NAME)).toBeUndefined();
  });

  it.each(["error result", "thrown error"])(
    "preserves an active guard and cookies when getClaims has an indeterminate %s",
    async (failureMode) => {
      const guard = await activeSessionGuardValue(
        "11111111-1111-4111-8111-111111111111",
      );
      const request = new NextRequest("https://homerelay.test/record", {
        headers: {
          cookie: [
            `${SESSION_GUARD_COOKIE_NAME}=${guard}`,
            "sb-synthetic-auth-token=stale",
            "sb-other-auth-token=keep-me",
            "unrelated=keep-me-too",
          ].join("; "),
        },
      });

      if (failureMode === "error result") {
        mocks.getClaims.mockResolvedValue({
          data: null,
          error: new Error("synthetic claims error"),
        });
      } else {
        mocks.getClaims.mockRejectedValue(new Error("synthetic claims failure"));
      }

      const response = await updateSession(request);

      expect(response.status).toBe(503);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
      expect(response.cookies.get("sb-other-auth-token")).toBeUndefined();
      expect(response.cookies.get("unrelated")).toBeUndefined();
      expect(request.cookies.get("sb-synthetic-auth-token")?.value).toBe(
        "stale",
      );
    },
  );

  it.each([401, 403, 429, 503])(
    "does not infer logout from an unknown status %i",
    async (status) => {
      const guard = await activeSessionGuardValue(
        "11111111-1111-4111-8111-111111111111",
      );
      const request = new NextRequest("https://homerelay.test/record", {
        headers: {
          cookie: `${SESSION_GUARD_COOKIE_NAME}=${guard}; sb-synthetic-auth-token=current`,
        },
      });
      mocks.getClaims.mockResolvedValue({ data: null, error: { status } });

      const response = await updateSession(request);

      expect(response.status).toBe(503);
      expect(response.headers.get("location")).toBeNull();
      expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
    },
  );

  it("clears an active session only for a documented terminal Auth error", async () => {
    const guard = await activeSessionGuardValue(
      "11111111-1111-4111-8111-111111111111",
    );
    const request = new NextRequest("https://homerelay.test/record", {
      headers: {
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${guard}; sb-synthetic-auth-token=expired`,
      },
    });
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: { code: "session_expired", status: 400 },
    });

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/login",
    );
    expect(response.cookies.get("sb-synthetic-auth-token")?.maxAge).toBe(0);
  });

  it("lets /api/session return its own status after clearing a terminal active session", async () => {
    const guard = await activeSessionGuardValue(
      "11111111-1111-4111-8111-111111111111",
    );
    const request = new NextRequest("https://homerelay.test/api/session", {
      headers: {
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${guard}; sb-synthetic-auth-token=expired`,
      },
    });
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: { code: "session_expired", status: 400 },
    });

    const response = await updateSession(request);

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get("sb-synthetic-auth-token")?.maxAge).toBe(0);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("withholds buffered refresh cookies when claims are indeterminate", async () => {
    const request = new NextRequest("https://homerelay.test/record", {
      headers: { cookie: "sb-synthetic-auth-token=current" },
    });
    mocks.getClaims.mockImplementation(async () => {
      clientOptions?.cookies.setAll(
        [
          {
            name: "sb-synthetic-auth-token",
            options: { httpOnly: true, path: "/" },
            value: "unchecked-refresh",
          },
        ],
        { "x-unchecked-refresh": "blocked" },
      );
      return { data: null, error: { status: 503 } };
    });

    const response = await updateSession(request);

    expect(response.status).toBe(503);
    expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
    expect(response.headers.get("x-unchecked-refresh")).toBeNull();
    expect(request.cookies.get("sb-synthetic-auth-token")?.value).toBe(
      "current",
    );
  });

  it.each(["/login", "/logout", "/api/session", "/api/status"])(
    "keeps public path %s reachable without releasing an indeterminate refresh",
    async (pathname) => {
      const request = new NextRequest(`https://homerelay.test${pathname}`, {
        headers: { cookie: "sb-synthetic-auth-token=current" },
      });
      mocks.getClaims.mockImplementation(async () => {
        clientOptions?.cookies.setAll(
          [
            {
              name: "sb-synthetic-auth-token",
              options: { httpOnly: true, path: "/" },
              value: "unchecked-refresh",
            },
          ],
          { "x-unchecked-refresh": "blocked" },
        );
        return { data: null, error: { status: 503 } };
      });

      const response = await updateSession(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
      expect(response.headers.get("x-unchecked-refresh")).toBeNull();
      expect(request.cookies.get("sb-synthetic-auth-token")?.value).toBe(
        "current",
      );
    },
  );

  it.each([
    { expectedStatus: 200, pathname: "/api/session", publicPath: true },
    { expectedStatus: 503, pathname: "/record", publicPath: false },
  ])(
    "fails $pathname according to its public boundary when guard verification throws",
    async ({ expectedStatus, pathname, publicPath }) => {
      const request = new NextRequest(`https://homerelay.test${pathname}`, {
        headers: {
          cookie: `${SESSION_GUARD_COOKIE_NAME}=v1:active:${"a".repeat(64)}; sb-synthetic-auth-token=current`,
        },
      });
      mocks.getClaims.mockImplementation(async () => {
        clientOptions?.cookies.setAll(
          [
            {
              name: "sb-synthetic-auth-token",
              options: { httpOnly: true, path: "/" },
              value: "unchecked-refresh",
            },
          ],
          { "x-unchecked-refresh": "blocked" },
        );
        return {
          data: {
            claims: {
              session_id: "11111111-1111-4111-8111-111111111111",
              sub: "synthetic-user",
            },
          },
          error: null,
        };
      });
      const digest = vi
        .spyOn(globalThis.crypto.subtle, "digest")
        .mockRejectedValueOnce(new Error("synthetic digest failure"));

      try {
        const response = await updateSession(request);

        expect(response.status).toBe(expectedStatus);
        expect(response.headers.get("x-middleware-next")).toBe(
          publicPath ? "1" : null,
        );
        expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
        expect(response.headers.get("x-unchecked-refresh")).toBeNull();
        expect(request.cookies.get("sb-synthetic-auth-token")?.value).toBe(
          "current",
        );
      } finally {
        digest.mockRestore();
      }
    },
  );

  it("makes signed-out authoritative without contacting Supabase", async () => {
    const request = new NextRequest("https://homerelay.test/", {
      headers: {
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${signedOutSessionGuardValue()}; sb-synthetic-auth-token=late`,
      },
    });

    const response = await updateSession(request);

    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/login",
    );
    expect(response.cookies.get("sb-synthetic-auth-token")?.maxAge).toBe(0);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("strips stale auth from a login POST request without expiring a new response cookie", async () => {
    const request = new NextRequest("https://homerelay.test/login", {
      headers: {
        cookie: `${SESSION_GUARD_COOKIE_NAME}=${signedOutSessionGuardValue()}; sb-synthetic-auth-token=late`,
      },
      method: "POST",
    });

    const response = await updateSession(request);

    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-synthetic-auth-token=",
    );
    expect(response.cookies.get("sb-synthetic-auth-token")).toBeUndefined();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated protected request to login", async () => {
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: { code: "session_not_found", status: 400 },
    });
    const request = new NextRequest("https://homerelay.test/record?from=demo");

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/login",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["/login", "/logout", "/api/session", "/api/status"])(
    "keeps the public path %s available without a session",
    async (pathname) => {
      mocks.getClaims.mockResolvedValue({
        data: null,
        error: { name: "AuthSessionMissingError", status: 400 },
      });

      const response = await updateSession(
        new NextRequest(`https://homerelay.test${pathname}`),
      );

      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );
});
