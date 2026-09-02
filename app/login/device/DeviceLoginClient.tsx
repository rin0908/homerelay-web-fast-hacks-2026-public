"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  consumeDeviceMagicLink,
  type DeviceLoginOutcome,
  type DeviceLoginRole,
} from "@/lib/supabase/device-login";
import {
  createEphemeralClient,
  createTransferClient,
} from "@/lib/supabase/client";

let capturedHash = "";
if (typeof window !== "undefined") {
  capturedHash = window.location.hash;
  if (capturedHash || window.location.search) {
    window.history.replaceState(
      null,
      "",
      window.location.pathname,
    );
  }
}

const MESSAGE: Record<Exclude<DeviceLoginOutcome, "success">, string> = {
  invalid: "この一度限りの認証は使用できません。再発行が必要です。",
  membership:
    "招待済みの家族または訪問ヘルパーであることを確認できませんでした。",
  unavailable: "現在ログインを確認できません。再発行してからお試しください。",
};

async function prepareDeviceSession(): Promise<boolean> {
  const response = await fetch("/login/device/session?phase=begin", {
    credentials: "same-origin",
    method: "POST",
  });
  return response.ok;
}

async function completeDeviceSession({
  authUserId,
  expectedRole,
}: {
  authUserId: string;
  expectedRole: DeviceLoginRole;
}): Promise<boolean> {
  const response = await fetch("/login/device/session?phase=complete", {
    body: JSON.stringify({ authUserId, expectedRole }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return response.ok;
}

export function DeviceLoginClient({
  expectedRole,
  heading,
}: {
  expectedRole: DeviceLoginRole;
  heading: string;
}) {
  const [outcome, setOutcome] = useState<
    Exclude<DeviceLoginOutcome, "success"> | "checking"
  >("checking");
  const authenticationRef = useRef<Promise<DeviceLoginOutcome> | null>(null);

  useEffect(() => {
    let active = true;

    if (!authenticationRef.current) {
      const hash = capturedHash;
      capturedHash = "";
      authenticationRef.current = consumeDeviceMagicLink(
        {
          completePersistentSession: completeDeviceSession,
          createPersistentClient: createTransferClient,
          createVerificationClient: createEphemeralClient,
          preparePersistentSession: prepareDeviceSession,
        },
        hash,
        expectedRole,
      ).catch(() => "unavailable");
    }

    const authentication = authenticationRef.current;

    async function authenticate() {
      const result = await authentication;
      if (!active) return;
      if (result === "success") {
        window.location.replace("/");
        return;
      }
      setOutcome(result);
    }

    void authenticate();
    return () => {
      active = false;
    };
  }, [expectedRole]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-5 py-10 sm:px-8">
      <section className="soft-card p-6 text-center" aria-live="polite">
        <p className="eyebrow">HOMERELAY</p>
        <h1 className="mt-3 text-2xl font-semibold text-[var(--color-heading)]">
          {heading}
        </h1>
        {outcome === "checking" ? (
          <p className="mt-4 text-[var(--color-secondary)]">
            一度限りの認証を確認しています…
          </p>
        ) : (
          <>
            <p className="mt-4 text-[var(--color-secondary)]">
              {MESSAGE[outcome]}
            </p>
            <Link className="secondary-button mt-6 w-full" href="/login">
              通常のログイン画面へ
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
