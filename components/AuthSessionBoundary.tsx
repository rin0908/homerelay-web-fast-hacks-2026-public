"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { RelayMode } from "@/lib/relay/types";
import { createClient } from "@/lib/supabase/client";

export function AuthSessionBoundary({
  children,
  mode,
}: {
  children: ReactNode;
  mode: RelayMode;
}) {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    if (mode !== "supabase") return;
    const client = createClient();
    if (!client) return;

    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setSignedOut(true);
        router.replace("/login");
        router.refresh();
      } else if (event === "USER_UPDATED") {
        router.refresh();
      }
    });

    return () => data.subscription.unsubscribe();
  }, [mode, router]);

  if (signedOut) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-xl px-5 py-12" aria-live="polite">
        <p className="soft-card p-6 text-center text-[var(--color-secondary)]">
          ログアウトしました。ログイン画面へ移動します。
        </p>
      </main>
    );
  }

  return children;
}
