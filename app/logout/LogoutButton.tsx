"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  supportsAuthSessionLock,
  withAuthSessionLock,
} from "@/lib/supabase/auth-session-lock";
import { createClient } from "@/lib/supabase/client";

const LOGOUT_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const LOCAL_SIGN_OUT_NOTIFICATION_TIMEOUT_MS = 750;
const LOGOUT_ERROR_MESSAGE =
  "ログアウトを完了できませんでした。もう一度お試しください。";
const LOGOUT_UNSUPPORTED_MESSAGE =
  "このブラウザでは安全なログアウトを開始できません。最新版のSafariまたはChromeで開いてください。";
type AuthCapability = "checking" | "ready" | "unsupported";

async function notifyOtherTabsOfLocalSignOut(): Promise<void> {
  const client = createClient();
  if (!client) return;

  await new Promise<void>((resolve) => {
    let completed = false;
    function finish() {
      if (completed) return;
      completed = true;
      window.clearTimeout(timer);
      resolve();
    }

    const timer = window.setTimeout(
      finish,
      LOCAL_SIGN_OUT_NOTIFICATION_TIMEOUT_MS,
    );
    void client.auth.signOut({ scope: "local" }).then(finish, finish);
  });
}

async function commitServerLogout(): Promise<void> {
  const response = await fetch("/logout", {
    credentials: "same-origin",
    headers: { "X-HomeRelay-Logout": "fetch" },
    method: "POST",
  });
  if (!response.ok) throw new Error("logout_not_committed");

  // The HttpOnly server guard is already signed-out. This best-effort local
  // notification only helps other open tabs hide cached UI immediately; it is
  // not part of the authoritative logout decision.
  try {
    await notifyOtherTabsOfLocalSignOut();
  } catch {
    // The server guard remains authoritative.
  }
}

export function LogoutButton() {
  const [authCapability, setAuthCapability] =
    useState<AuthCapability>("checking");
  const submissionPendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (supportsAuthSessionLock()) {
        setAuthCapability("ready");
      } else {
        // Keep the mutation fail-closed when this browser cannot serialize
        // auth changes with password/device login in other tabs.
        setAuthCapability("unsupported");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authCapability !== "ready" || !supportsAuthSessionLock()) {
      setAuthCapability("unsupported");
      return;
    }
    if (submissionPendingRef.current) return;
    submissionPendingRef.current = true;
    setFailed(false);
    setPending(true);

    try {
      await withAuthSessionLock(commitServerLogout, {
        acquireTimeoutMs: LOGOUT_LOCK_ACQUIRE_TIMEOUT_MS,
      });
      window.location.replace("/login?loggedOut=1");
    } catch {
      setFailed(true);
      submissionPendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending}>
      <button
        className="secondary-button min-h-10 px-3 py-2 text-sm"
        disabled={authCapability !== "ready" || pending}
        type="submit"
      >
        {pending ? "ログアウトしています…" : "ログアウト"}
      </button>
      {pending ? (
        <p aria-live="polite" className="sr-only" role="status">
          ログアウトを確認しています。
        </p>
      ) : null}
      {authCapability === "checking" ? (
        <p aria-live="polite" className="sr-only" role="status">
          安全なログアウトを準備しています。
        </p>
      ) : null}
      {authCapability === "unsupported" || failed ? (
        <p
          className="mt-2 max-w-64 rounded-xl bg-[#fff4e7] p-3 text-sm font-semibold text-[#85572f]"
          role="alert"
        >
          {authCapability === "unsupported"
            ? LOGOUT_UNSUPPORTED_MESSAGE
            : LOGOUT_ERROR_MESSAGE}
        </p>
      ) : null}
      <noscript>
        <p className="mt-2 max-w-64 rounded-xl bg-[#fff4e7] p-3 text-sm font-semibold text-[#85572f]">
          安全にログアウトするにはJavaScriptを有効にし、最新版のSafariまたはChromeで開いてください。
        </p>
      </noscript>
    </form>
  );
}
