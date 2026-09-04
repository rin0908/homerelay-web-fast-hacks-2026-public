"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { RelayMode } from "@/lib/relay/types";
import { classifyClaimsResult } from "@/lib/supabase/auth-resolution";
import { createClient } from "@/lib/supabase/client";
import { fingerprintSessionId } from "@/lib/supabase/session-guard";

const SERVER_SESSION_CHECK_TIMEOUT_MS = 10_000;
const SESSION_RECHECK_INTERVAL_MS = 60_000;
const SESSION_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

type AuthoritativeServerSession = {
  sessionFingerprint: string;
  userId: string;
};

type IdentityResolution =
  | { state: "indeterminate" }
  | { state: "terminal" }
  | { session: AuthoritativeServerSession; state: "verified" };

async function authoritativeServerSession(): Promise<IdentityResolution> {
  const abortController = new AbortController();
  const timer = window.setTimeout(
    () => abortController.abort(),
    SERVER_SESSION_CHECK_TIMEOUT_MS,
  );
  try {
    const response = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      signal: abortController.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { state: "terminal" };
    }
    if (response.status !== 200) return { state: "indeterminate" };
    const body = (await response.json()) as {
      sessionFingerprint?: unknown;
      userId?: unknown;
    };
    return body &&
      typeof body.userId === "string" &&
      body.userId.length > 0 &&
      body.userId.length <= 128 &&
      typeof body.sessionFingerprint === "string" &&
      SESSION_FINGERPRINT_PATTERN.test(body.sessionFingerprint)
      ? {
          session: {
            sessionFingerprint: body.sessionFingerprint,
            userId: body.userId,
          },
          state: "verified",
        }
      : { state: "indeterminate" };
  } catch {
    return { state: "indeterminate" };
  } finally {
    window.clearTimeout(timer);
  }
}

export function AuthSessionBoundary({
  children,
  expectedAuthUserId,
  expectedSessionFingerprint,
  mode,
}: {
  children: ReactNode;
  expectedAuthUserId: string | null;
  expectedSessionFingerprint: string | null;
  mode: RelayMode;
}) {
  const router = useRouter();
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [verifiedSessionFingerprint, setVerifiedSessionFingerprint] = useState<
    string | null
  >(null);
  const [invalidated, setInvalidated] = useState(false);

  useEffect(() => {
    if (mode !== "supabase") return;
    if (!expectedAuthUserId || !expectedSessionFingerprint) {
      router.replace("/login");
      router.refresh();
      return;
    }
    const client = createClient();
    if (!client) {
      // Missing runtime configuration is not evidence that an existing
      // browser session ended. Keep private content hidden without deleting
      // credentials or starting a redirect loop.
      return;
    }
    const authenticatedClient = client;

    let active = true;
    let checking = false;
    let latestGeneration = 0;
    let recheckQueued = false;

    function invalidate() {
      if (!active) return;
      setVerifiedUserId(null);
      setVerifiedSessionFingerprint(null);
      setInvalidated(true);
      router.replace("/login");
      router.refresh();
    }

    function hidePrivateContent() {
      if (!active) return;
      setVerifiedUserId(null);
      setVerifiedSessionFingerprint(null);
    }

    async function browserSession(): Promise<IdentityResolution> {
      try {
        const current = classifyClaimsResult(
          await authenticatedClient.auth.getClaims(),
        );
        if (current.state !== "verified") {
          return {
            state: current.state === "unauthenticated"
              ? "terminal"
              : "indeterminate",
          };
        }
        const currentSessionFingerprint =
          await fingerprintSessionId(current.value.sessionId);
        if (!currentSessionFingerprint) return { state: "indeterminate" };
        return {
          session: {
            sessionFingerprint: currentSessionFingerprint,
            userId: current.value.userId,
          },
          state: "verified",
        };
      } catch {
        return { state: "indeterminate" };
      }
    }

    async function runIdentityChecks(generation: number) {
      checking = true;

      while (active) {
        const [browser, server] = await Promise.all([
          browserSession(),
          authoritativeServerSession(),
        ]);

        if (!active) break;
        // An auth/focus/pageshow event that happened after this request began
        // may represent a refreshed session. Give that newer generation one
        // authoritative check before treating an older 401/403 as terminal.
        if (
          (browser.state === "terminal" || server.state === "terminal") &&
          generation !== latestGeneration &&
          recheckQueued
        ) {
          recheckQueued = false;
          generation = latestGeneration;
          continue;
        }
        if (browser.state === "terminal" || server.state === "terminal") {
          invalidate();
          break;
        }
        if (
          browser.state === "indeterminate" ||
          server.state === "indeterminate"
        ) {
          // Do not turn a timeout, rate limit, provider outage, SDK exception,
          // or malformed response into logout. The next interval, focus,
          // pageshow, visibility, or auth event may recover the same session.
          if (generation !== latestGeneration && recheckQueued) {
            recheckQueued = false;
            generation = latestGeneration;
            continue;
          }
          hidePrivateContent();
          break;
        }

        const matchesExpectedIdentity =
          browser.session.userId === expectedAuthUserId &&
          server.session.userId === expectedAuthUserId &&
          browser.session.sessionFingerprint ===
            server.session.sessionFingerprint &&
          browser.session.sessionFingerprint === expectedSessionFingerprint;
        if (!matchesExpectedIdentity) {
          invalidate();
          break;
        }
        if (generation === latestGeneration) {
          setVerifiedUserId(expectedAuthUserId);
          setVerifiedSessionFingerprint(expectedSessionFingerprint);
        }

        if (!recheckQueued) break;
        recheckQueued = false;
        generation = latestGeneration;
      }

      checking = false;
    }

    function requestIdentityCheck(hideWhileChecking: boolean) {
      if (!active) return;
      // Periodic checks never supersede in-flight work. This prevents a slow
      // provider read from being perpetually made stale by the background tick.
      if (checking && !hideWhileChecking) return;
      const generation = ++latestGeneration;
      if (hideWhileChecking) {
        setVerifiedUserId(null);
        setVerifiedSessionFingerprint(null);
      }
      if (checking) {
        recheckQueued = true;
        return;
      }
      // A queued marker belongs only to the in-flight check that observed it.
      // Never let it cause an unprompted rapid retry on a later event.
      recheckQueued = false;
      void runIdentityChecks(generation);
    }

    const { data } = authenticatedClient.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          invalidate();
        } else if (session && session.user.id !== expectedAuthUserId) {
          invalidate();
        } else {
          // Same-user sign-in/token changes still need the exact session
          // fingerprint check. Hide private children until both the browser
          // and HttpOnly server guard confirm the RSC-bound session again.
          requestIdentityCheck(true);
          if (event === "USER_UPDATED") router.refresh();
        }
      },
    );

    function checkWhenVisible(hideWhileChecking = false) {
      if (document.visibilityState !== "hidden") {
        requestIdentityCheck(hideWhileChecking);
      }
    }

    requestIdentityCheck(false);
    const checkAfterFocus = () => checkWhenVisible(true);
    window.addEventListener("focus", checkAfterFocus);
    window.addEventListener("pageshow", checkAfterFocus);
    document.addEventListener("visibilitychange", checkAfterFocus);
    const interval = window.setInterval(
      () => checkWhenVisible(false),
      SESSION_RECHECK_INTERVAL_MS,
    );

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkAfterFocus);
      window.removeEventListener("pageshow", checkAfterFocus);
      document.removeEventListener("visibilitychange", checkAfterFocus);
      data.subscription.unsubscribe();
    };
  }, [expectedAuthUserId, expectedSessionFingerprint, mode, router]);

  if (
    invalidated ||
    (mode === "supabase" &&
      (!expectedAuthUserId || !expectedSessionFingerprint))
  ) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-xl px-5 py-12" aria-live="polite">
        <p className="soft-card p-6 text-center text-[var(--color-secondary)]">
          ログイン状態が変わりました。ログイン画面へ移動します。
        </p>
      </main>
    );
  }

  if (
    mode === "supabase" &&
    (verifiedUserId !== expectedAuthUserId ||
      verifiedSessionFingerprint !== expectedSessionFingerprint)
  ) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-xl px-5 py-12" aria-live="polite">
        <p className="soft-card p-6 text-center text-[var(--color-secondary)]">
          ログインを安全に確認しています…
        </p>
      </main>
    );
  }

  return children;
}
