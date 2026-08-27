import Link from "next/link";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { DemoHomeFeed } from "@/components/DemoHomeFeed";
import { ArrowRight, Camera, HeartHandshake } from "@/components/Icons";
import { RoleBadge } from "@/components/RoleBadge";
import { getIntegrationStatus } from "@/lib/integration-status";
import { SYNTHETIC_ENTRIES } from "@/lib/synthetic-data";

export default function HomePage() {
  const status = getIntegrationStatus();

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-5 py-5 sm:px-8 sm:py-7 lg:px-10">
      {status.appMode === "demo" ? <DemoModeBanner /> : null}

      <header className="mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-divider)] pb-5">
        <Link className="flex items-center gap-3 rounded-xl" href="/" aria-label="HomeRelay 今日の様子">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white">
            <HeartHandshake aria-hidden="true" size={24} strokeWidth={1.8} />
          </span>
          <span>
            <span className="block text-xs font-semibold tracking-[0.14em] text-[var(--color-primary)]">HOMERELAY</span>
            <span className="block text-sm text-[var(--color-secondary)]">温かい申し送り</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-[var(--color-secondary)] sm:inline">表示中</span>
          <RoleBadge role="family" />
        </div>
      </header>

      <section className="py-8 sm:py-10">
        <p className="eyebrow">Family handoff</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-[-0.045em] text-[var(--color-heading)] sm:text-5xl">
              今日の様子
            </h1>
            <p className="mt-3 max-w-2xl text-base text-[var(--color-secondary)] sm:text-lg">
              確認された申し送りだけを、家族みんなで共有します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="利用できる役割">
            <RoleBadge role="family" />
            <RoleBadge role="relative" />
            <RoleBadge role="helper" />
          </div>
        </div>
      </section>

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-9">
        <DemoHomeFeed initialEntries={SYNTHETIC_ENTRIES} />

        <aside className="soft-card p-5 lg:sticky lg:top-6 lg:p-6" aria-labelledby="record-cta-title">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf4f1] text-[var(--color-primary)]">
            <Camera aria-hidden="true" size={25} />
          </span>
          <h2 className="mt-5 text-2xl font-semibold text-[var(--color-heading)]" id="record-cta-title">
            新しく伝える
          </h2>
          <p className="mt-2 text-base text-[var(--color-secondary)]">写真と声だけ。確認してから共有します。</p>
          <Link className="primary-button mt-6 w-full" href="/record">
            <Camera aria-hidden="true" size={22} />
            写真を撮る
            <ArrowRight aria-hidden="true" size={19} />
          </Link>
          <ol className="mt-6 space-y-3 border-t border-[var(--color-divider)] pt-5 text-sm text-[var(--color-body)]">
            {[
              "写真を撮る",
              "話す",
              "これでOK",
              "次の人へ",
            ].map((label, index) => (
              <li className="flex items-center gap-3" key={label}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f1eee6] text-xs font-semibold text-[var(--color-primary)]">
                  {index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <footer className="mt-10 border-t border-[var(--color-divider)] py-7 text-center text-sm text-[var(--color-secondary)]">
        HomeRelayは監視ではなく、次の人へ温かくバトンを渡すための家族共有です。
      </footer>
    </main>
  );
}
