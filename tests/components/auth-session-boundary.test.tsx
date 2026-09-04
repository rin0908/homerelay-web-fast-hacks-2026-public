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
  vi.useRealTimers();
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
    mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));
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

  it("treats an infrastructure redirect as indeterminate, not logout", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 307 }));
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(screen.queryByText("synthetic private handoff")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();

    mocks.fetch.mockImplementation(() => serverSessionResponse());
    act(() => window.dispatchEvent(new Event("focus")));

    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("hides without logout and recovers on focus after a server request rejects", async () => {
    mocks.fetch.mockRejectedValue(new Error("synthetic server failure"));
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("ログインを安全に確認しています…"),
    ).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();

    mocks.fetch.mockImplementation(() => serverSessionResponse());
    act(() => window.dispatchEvent(new Event("focus")));

    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("hides without logout and recovers on focus after browser claims reject", async () => {
    mocks.getClaims.mockRejectedValue(new Error("synthetic claims failure"));
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );

    await waitFor(() => expect(mocks.getClaims).toHaveBeenCalledOnce());
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("ログインを安全に確認しています…"),
    ).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.getClaims).toHaveBeenCalledOnce();

    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          session_id: SESSION_ID,
          sub: "synthetic-expected-user",
        },
      },
      error: null,
    });
    act(() => window.dispatchEvent(new Event("focus")));

    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 503])(
    "does not infer logout from an unknown Auth status %i",
    async (status) => {
      mocks.getClaims.mockResolvedValue({ data: null, error: { status } });
      render(
        <AuthSessionBoundary
          expectedAuthUserId="synthetic-expected-user"
          mode="supabase"
        >
          <p>synthetic private handoff</p>
        </AuthSessionBoundary>,
      );

      await waitFor(() => expect(mocks.getClaims).toHaveBeenCalledOnce());
      expect(screen.queryByText("synthetic private handoff")).not.toBeInTheDocument();
      expect(mocks.replace).not.toHaveBeenCalled();

      mocks.getClaims.mockResolvedValue({
        data: {
          claims: {
            session_id: SESSION_ID,
            sub: "synthetic-expected-user",
          },
        },
        error: null,
      });
      act(() => window.dispatchEvent(new Event("focus")));

      expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
      expect(mocks.getClaims).toHaveBeenCalledTimes(2);
      expect(mocks.replace).not.toHaveBeenCalled();
    },
  );

  it("redirects only for a documented terminal browser Auth error", async () => {
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: { code: "session_expired", status: 400 },
    });
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("synthetic private handoff")).not.toBeInTheDocument();
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

  it("hides private children while a same-user auth change is rechecked", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();

    let releaseClaims!: () => void;
    const claimsCanResolve = new Promise<void>((resolve) => {
      releaseClaims = resolve;
    });
    mocks.getClaims.mockImplementationOnce(async () => {
      await claimsCanResolve;
      return {
        data: {
          claims: {
            session_id: SESSION_ID,
            sub: "synthetic-expected-user",
          },
        },
        error: null,
      };
    });

    act(() =>
      mocks.callback?.("TOKEN_REFRESHED", {
        user: { id: "synthetic-expected-user" },
      }),
    );
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();

    await act(async () => {
      releaseClaims();
      await claimsCanResolve;
    });
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
  });

  it("uses a relaxed 60-second background recheck interval", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    try {
      render(
        <AuthSessionBoundary
          expectedAuthUserId="synthetic-expected-user"
          mode="supabase"
        >
          <p>synthetic private handoff</p>
        </AuthSessionBoundary>,
      );

      expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
      expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    } finally {
      intervalSpy.mockRestore();
    }
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

  it("consumes one queued event after an in-flight indeterminate result", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();

    let releaseUnavailable!: () => void;
    const unavailableCanFinish = new Promise<void>((resolve) => {
      releaseUnavailable = resolve;
    });
    let unavailableStarted!: () => void;
    const unavailableHasStarted = new Promise<void>((resolve) => {
      unavailableStarted = resolve;
    });
    mocks.getClaims.mockImplementationOnce(async () => {
      unavailableStarted();
      await unavailableCanFinish;
      return { data: null, error: { status: 503 } };
    });

    act(() => window.dispatchEvent(new Event("focus")));
    await unavailableHasStarted;
    act(() => window.dispatchEvent(new Event("pageshow")));
    await act(async () => {
      releaseUnavailable();
      await unavailableCanFinish;
    });

    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
    expect(mocks.getClaims).toHaveBeenCalledTimes(3);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("rechecks a newer queued generation before accepting an old terminal response", async () => {
    render(
      <AuthSessionBoundary
        expectedAuthUserId="synthetic-expected-user"
        mode="supabase"
      >
        <p>synthetic private handoff</p>
      </AuthSessionBoundary>,
    );
    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();

    let releaseOldResponse!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      releaseOldResponse = resolve;
    });
    let oldCheckStarted!: () => void;
    const oldCheckHasStarted = new Promise<void>((resolve) => {
      oldCheckStarted = resolve;
    });
    mocks.fetch.mockImplementationOnce(async () => {
      oldCheckStarted();
      return oldResponse;
    });

    act(() => window.dispatchEvent(new Event("focus")));
    await oldCheckHasStarted;
    expect(
      screen.queryByText("synthetic private handoff"),
    ).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("pageshow")));
    await act(async () => {
      releaseOldResponse(new Response(null, { status: 401 }));
      await oldResponse;
    });

    expect(await screen.findByText("synthetic private handoff")).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.replace).not.toHaveBeenCalled();
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
