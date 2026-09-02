import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  const replace = vi.fn();
  return {
    callback: null as ((event: string, session?: unknown) => void) | null,
    createClient: vi.fn(),
    fetch: vi.fn(),
    getClaims: vi.fn(),
    refresh,
    replace,
    router: { refresh, replace },
    unsubscribe: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

import { AuthSessionBoundary as ProductionAuthSessionBoundary } from "@/components/AuthSessionBoundary";
import { fingerprintSessionId } from "@/lib/supabase/session-guard";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";
let expectedSessionFingerprint = "";

function AuthSessionBoundary({
  children,
  expectedAuthUserId,
  expectedSessionFingerprint: fingerprint = expectedSessionFingerprint,
  mode,
}: {
  children: ReactNode;
  expectedAuthUserId: string | null;
  expectedSessionFingerprint?: string | null;
  mode: "demo" | "supabase";
}) {
  return (
    <ProductionAuthSessionBoundary
      expectedAuthUserId={expectedAuthUserId}
      expectedSessionFingerprint={fingerprint}
      mode={mode}
    >
      {children}
    </ProductionAuthSessionBoundary>
  );
}

async function serverSessionResponse(
  userId = "synthetic-expected-user",
  sessionId = SESSION_ID,
): Promise<Response> {
  return Response.json({
    sessionFingerprint: await fingerprintSessionId(sessionId),
    userId,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  // clear queued one-shot implementations as well as call history so each
  // concurrency scenario starts from a deterministic identity read.
  mocks.getClaims.mockReset();
  mocks.createClient.mockReset();
  mocks.fetch.mockReset();
  mocks.callback = null;
  expectedSessionFingerprint =
    (await fingerprintSessionId(SESSION_ID)) ?? "";
  mocks.getClaims.mockResolvedValue({
    data: {
      claims: {
        session_id: SESSION_ID,
        sub: "synthetic-expected-user",
      },
    },
    error: null,
  });
  mocks.createClient.mockReturnValue({
    auth: {
      getClaims: mocks.getClaims,
      onAuthStateChange: (callback: (event: string, session?: unknown) => void) => {
        mocks.callback = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  });
  mocks.fetch.mockImplementation(() => serverSessionResponse());
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthSessionBoundary", () => {
  it("keeps private children hidden until the expected identity is verified", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("ログインを安全に確認しています…"),
    ).toBeInTheDocument();

    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
  });

  it("immediately hides private children when Supabase reports sign-out", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();

    act(() => mocks.callback?.("SIGNED_OUT"));

    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("ログイン状態が変わりました。ログイン画面へ移動します。"),
    ).toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("never reveals same-user DOM when the HttpOnly server guard rejects its session", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 307 }));
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    {
      serverSessionId: OTHER_SESSION_ID,
      serverUserId: "synthetic-expected-user",
    },
    {
      serverSessionId: SESSION_ID,
      serverUserId: "synthetic-different-user",
    },
  ])(
    "rejects split browser/server identity snapshots ($serverUserId)",
    async ({ serverSessionId, serverUserId }) => {
      mocks.fetch.mockImplementation(() =>
        serverSessionResponse(serverUserId, serverSessionId),
      );

      render(
        <AuthSessionBoundary
          expectedAuthUserId="synthetic-expected-user"
          mode="supabase"
        >
          <p>synthetic private handoff</p>
        </AuthSessionBoundary>,
      );

      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
      expect(
        screen.queryByText("synthetic private handoff"),
      ).not.toBeInTheDocument();
    },
  );

  it("never reveals a stale server component after the same user starts a new session", async () => {
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          session_id: OTHER_SESSION_ID,
          sub: "synthetic-expected-user",
        },
      },
      error: null,
    });
    mocks.fetch.mockImplementation(() =>
      serverSessionResponse("synthetic-expected-user", OTHER_SESSION_ID),
    );

    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>stale household handoff</p>
      </AuthSessionBoundary>,
    );

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("stale household handoff")).not.toBeInTheDocument();
  });

  it("hides private children when another tab changes the authenticated user", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();

    act(() =>
      mocks.callback?.("SIGNED_IN", {
        user: { id: "synthetic-different-user" },
      }),
    );

    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("rechecks the verified user when the tab regains focus", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          session_id: OTHER_SESSION_ID,
          sub: "synthetic-different-user",
        },
      },
      error: null,
    });

    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
  });

  it("never reuses a stale in-flight identity check after a newer focus check", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();

    let releaseStaleCheck!: () => void;
    const staleCheck = new Promise<void>((resolve) => {
      releaseStaleCheck = resolve;
    });
    let staleCheckStarted!: () => void;
    const staleCheckHasStarted = new Promise<void>((resolve) => {
      staleCheckStarted = resolve;
    });
    mocks.getClaims
      .mockImplementationOnce(async () => {
        staleCheckStarted();
        await staleCheck;
        return {
          data: {
            claims: {
              session_id: SESSION_ID,
              sub: "synthetic-expected-user",
            },
          },
          error: null,
        };
      })
      .mockResolvedValue({
        data: {
          claims: {
            session_id: OTHER_SESSION_ID,
            sub: "synthetic-different-user",
          },
        },
        error: null,
      });

    act(() => window.dispatchEvent(new Event("focus")));
    await staleCheckHasStarted;
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("pageshow")));
    releaseStaleCheck();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    expect(mocks.getClaims.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("fails closed when a stale in-flight check sees a different user", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();

    const mismatchedIdentity = {
      data: {
        claims: {
          session_id: OTHER_SESSION_ID,
          sub: "synthetic-different-user",
        },
      },
      error: null,
    };
    let releaseStaleCheck!: (value: typeof mismatchedIdentity) => void;
    const staleCheck = new Promise<typeof mismatchedIdentity>((resolve) => {
      releaseStaleCheck = resolve;
    });
    let staleMismatchCheckStarted!: () => void;
    const staleMismatchCheckHasStarted = new Promise<void>((resolve) => {
      staleMismatchCheckStarted = resolve;
    });
    mocks.getClaims.mockResolvedValue({
        data: {
          claims: {
            session_id: SESSION_ID,
            sub: "synthetic-expected-user",
          },
        },
        error: null,
      });
    mocks.getClaims.mockImplementationOnce(async () => {
      staleMismatchCheckStarted();
      return staleCheck;
    });

    act(() => window.dispatchEvent(new Event("focus")));
    await staleMismatchCheckHasStarted;
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("pageshow")));
    await act(async () => {
      releaseStaleCheck(mismatchedIdentity);
      await staleCheck;
    });

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
  });

  it("does not show new children under a previously verified user id", async () => {
    const view = render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>household A</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("household A")).toBeInTheDocument();

    let releaseNewIdentity!: () => void;
    const newIdentity = new Promise<void>((resolve) => {
      releaseNewIdentity = resolve;
    });
    let newIdentityCheckStarted!: () => void;
    const newIdentityCheckHasStarted = new Promise<void>((resolve) => {
      newIdentityCheckStarted = resolve;
    });
    mocks.getClaims.mockImplementation(async () => {
      newIdentityCheckStarted();
      await newIdentity;
      return {
        data: {
          claims: {
            session_id: OTHER_SESSION_ID,
            sub: "synthetic-new-user",
          },
        },
        error: null,
      };
    });
    mocks.fetch.mockImplementation(() =>
      serverSessionResponse("synthetic-new-user", OTHER_SESSION_ID),
    );
    const newSessionFingerprint = await fingerprintSessionId(OTHER_SESSION_ID);
    view.rerender(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-new-user"
        expectedSessionFingerprint={newSessionFingerprint}
        mode="supabase"
      >
        <p>household B</p>
      </AuthSessionBoundary>,
    );

    await newIdentityCheckHasStarted;
    expect(screen.queryByText("household B")).not.toBeInTheDocument();
    await act(async () => {
      releaseNewIdentity();
      await newIdentity;
    });
    expect(await screen.findByText("household B")).toBeInTheDocument();
  });

  it("does not initialize Supabase auth in synthetic demo mode", () => {
    render(
      <AuthSessionBoundary expectedAuthUserId={null} mode="demo">
        <p>synthetic demo</p>
      </AuthSessionBoundary>,
    );

    expect(screen.getByText("synthetic demo")).toBeInTheDocument();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
