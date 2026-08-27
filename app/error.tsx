"use client";

import { RotateCcw } from "@/components/Icons";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10">
      <section className="w-full rounded-3xl border border-[var(--color-divider)] bg-[var(--color-card)] p-7 shadow-[var(--shadow-card)]">
        <p className="text-sm font-semibold text-[var(--color-warning)]">うまく読み込めませんでした</p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--color-heading)]">もう一度お試しください</h1>
        <button
          className="mt-6 inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[var(--color-primary)] px-6 font-semibold text-white"
          onClick={reset}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={20} />
          もう一度
        </button>
      </section>
    </main>
  );
}
