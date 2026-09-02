"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { RelayMode } from "@/lib/relay/types";
import { createClient } from "@/lib/supabase/client";
import {
  fingerprintSessionId,
  sessionIdFromClaims,
} from "@/lib/supabase/session-guard";

const SERVER_SESSION_CHECK_TIMEOUT_MS = 10_000;
const SESSION_RECHECK_INTERVAL_MS = 60_000;
const SESSION_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

type AuthoritativeServerSession = {
  sessionFingerprint: string;
  userId: string;
};

async function authoritativeServerSession(): Promise<AuthoritativeServerSession | null> {
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
    if (response.status !== 200) return null;
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
          sessionFingerprint: body.sessionFingerprint,
          userId: body.userId,
        }
      : null;
  } catch {
    return null;
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
      const timer = window.setTimeout(() => {
        setInvalidated(true);
        router.replace("/login");
        router.refresh();
      }, 0);
      return () => window.clearTimeout(timer);
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

    async function runIdentityChecks(generation: number) {
      checking = true;

      while (active) {
        let matchesExpectedIdentity = false;
        try {
          const [current, serverSession] = await Promise.all([
            authenticatedClient.auth.getClaims(),
            authoritativeServerSession(),
          ]);
          const currentClaims = current.data?.claims;
          const currentUserId = currentClaims?.sub;
          const currentSessionId = sessionIdFromClaims(currentClaims);
          const currentSessionFingerprint = currentSessionId
            ? await fingerprintSessionId(currentSessionId)
            : null;
          matchesExpectedIdentity =
            !current.error &&
            currentUserId === expectedAuthUserId &&
            serverSession?.userId === expectedAuthUserId &&
            currentSessionFingerprint !== null &&
            currentSessionFingerprint === serverSession.sessionFingerprint &&
            currentSessionFingerprint === expectedSessionFingerprint;
        } catch {
          matchesExpectedIdentity = false;
        }

        if (!active) break;
        // A failed or different-user read is always terminal, even if a newer
        // check was queued while this one was in flight. Generation ordering
        // only controls which successful read may reveal private children.
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
