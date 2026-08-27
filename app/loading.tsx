export default function Loading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8" aria-busy="true">
      <div className="h-6 w-40 animate-pulse rounded-full bg-[var(--color-divider)]" />
      <div className="mt-10 h-72 animate-pulse rounded-3xl bg-[var(--color-card)]" />
      <span className="sr-only">読み込み中です</span>
    </main>
  );
}
