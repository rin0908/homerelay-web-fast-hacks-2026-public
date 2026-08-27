import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10">
      <section className="w-full rounded-3xl border border-[var(--color-divider)] bg-[var(--color-card)] p-7 text-center shadow-[var(--shadow-card)]">
        <p className="text-sm font-semibold text-[var(--color-primary)]">ページが見つかりません</p>
        <h1 className="mt-2 text-3xl font-semibold text-[var(--color-heading)]">HomeRelay</h1>
        <Link
          className="mt-6 inline-flex min-h-14 items-center rounded-2xl bg-[var(--color-primary)] px-6 font-semibold text-white"
          href="/"
        >
          今日の様子へ戻る
        </Link>
      </section>
    </main>
  );
}
