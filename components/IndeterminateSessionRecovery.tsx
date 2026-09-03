"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const SESSION_RECHECK_INTERVAL_MS = 60_000;
const RECOVERY_REFRESH_COOLDOWN_MS = 10_000;

/**
 * Keeps an indeterminate, private-free server response recoverable without
 * converting an infrastructure failure into a logout or a tight refresh loop.
 */
export function IndeterminateSessionRecovery() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    let lastRefreshAt = Number.NEGATIVE_INFINITY;

    function refreshWhenVisible() {
      if (!active || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRefreshAt < RECOVERY_REFRESH_COOLDOWN_MS) return;
      lastRefreshAt = now;
      router.refresh();
    }

    const client = createClient();
    const subscription = client?.auth.onAuthStateChange((event) => {
      // INITIAL_SESSION is emitted as part of subscription setup and would
      // otherwise make a persistent outage refresh immediately on each mount.
      if (event !== "INITIAL_SESSION") refreshWhenVisible();
    });
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = window.setInterval(
      refreshWhenVisible,
      SESSION_RECHECK_INTERVAL_MS,
    );

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      subscription?.data.subscription.unsubscribe();
    };
  }, [router]);

  return null;
}
