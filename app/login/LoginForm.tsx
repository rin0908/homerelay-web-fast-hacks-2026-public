"use client";

import {
  type FormEvent,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import { unstable_rethrow } from "next/navigation";

import {
  supportsAuthSessionLock,
  withAuthSessionLock,
} from "@/lib/supabase/auth-session-lock";
import { withSupabaseBrowserAuthMutationLock } from "@/lib/supabase/browser-auth-lock";

type LoginAction = (formData: FormData) => Promise<void>;
type AuthCapability = "checking" | "ready" | "unsupported";
const LOGIN_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const LOGIN_ERROR_MESSAGE =
  "ログインを完了できませんでした。もう一度お試しください。";
const LOGIN_UNSUPPORTED_MESSAGE =
  "このブラウザでは安全なログインを開始できません。最新版のSafariまたはChromeで開いてください。";

export function LoginForm({ action }: { action: LoginAction }) {
  const [authCapability, setAuthCapability] =
    useState<AuthCapability>("checking");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const submissionPendingRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (supportsAuthSessionLock()) {
        setAuthCapability("ready");
      } else {
        // Authentication mutations must be serialized across tabs. Leaving
        // the controls disabled also prevents a native pre-hydration Server
        // Action submit from escaping that lock and racing a later logout.
        setAuthCapability("unsupported");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function beginSubmission(): boolean {
    if (submissionPendingRef.current) return false;
    submissionPendingRef.current = true;
    setFailed(false);
    setPending(true);
    return true;
  }

  async function runWithSessionLock(formData: FormData) {
    try {
      await withAuthSessionLock(
        () => withSupabaseBrowserAuthMutationLock(() => action(formData)),
        { acquireTimeoutMs: LOGIN_LOCK_ACQUIRE_TIMEOUT_MS },
      );
    } catch (error) {
      // A Server Action redirect is a framework control-flow exception. It
      // must reach Next.js so a successful login can finish its navigation.
      unstable_rethrow(error);
      // Never expose a provider, lock, credential, or network error message.
      setFailed(true);
    } finally {
      submissionPendingRef.current = false;
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authCapability !== "ready" || !supportsAuthSessionLock()) {
      setAuthCapability("unsupported");
      return;
    }
    if (!beginSubmission()) return;

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      await runWithSessionLock(formData);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="mt-6 space-y-5"
    >
      <label className="block text-sm font-semibold text-[var(--color-heading)]">
        メールアドレス
        <input
          autoComplete="email"
          className="mt-2 min-h-14 w-full rounded-xl border border-[var(--color-divider)] bg-white px-4 text-[var(--color-body)]"
          inputMode="email"
          maxLength={254}
          name="email"
          required
          disabled={authCapability !== "ready" || pending}
          type="email"
        />
      </label>
      <label className="block text-sm font-semibold text-[var(--color-heading)]">
        パスワード
        <input
          autoComplete="current-password"
          className="mt-2 min-h-14 w-full rounded-xl border border-[var(--color-divider)] bg-white px-4 text-[var(--color-body)]"
          maxLength={512}
          name="password"
          required
          disabled={authCapability !== "ready" || pending}
          type="password"
        />
      </label>
      <button
        className="primary-button w-full"
        disabled={authCapability !== "ready" || pending}
        type="submit"
      >
        {pending ? "ログインしています…" : "ログイン"}
      </button>
      {pending ? (
        <p aria-live="polite" className="sr-only" role="status">
          ログインを確認しています。
        </p>
      ) : null}
      {authCapability === "checking" ? (
        <p aria-live="polite" className="sr-only" role="status">
          安全なログインを準備しています。
        </p>
      ) : null}
      {authCapability === "unsupported" || failed ? (
        <p
          className="rounded-xl bg-[#fff4e7] p-3 text-sm font-semibold text-[#85572f]"
          role="alert"
        >
          {authCapability === "unsupported"
            ? LOGIN_UNSUPPORTED_MESSAGE
            : LOGIN_ERROR_MESSAGE}
        </p>
      ) : null}
      <noscript>
        <p className="rounded-xl bg-[#fff4e7] p-3 text-sm font-semibold text-[#85572f]">
          安全にログインするにはJavaScriptを有効にし、最新版のSafariまたはChromeで開いてください。
        </p>
      </noscript>
    </form>
  );
}
