import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthSessionBoundary } from "@/components/AuthSessionBoundary";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { ArrowRight, Camera, HeartHandshake } from "@/components/Icons";
import { IphoneInstallHint } from "@/components/IphoneInstallHint";
import { RelayHomeFeed } from "@/components/RelayHomeFeed";
import { RoleBadge } from "@/components/RoleBadge";
import { getIntegrationStatus } from "@/lib/integration-status";
import { DEMO_FAMILY_CONTEXT } from "@/lib/relay/contexts";
import type { HandoffRelayContext, RelayMode } from "@/lib/relay/types";
import { getCurrentSession } from "@/lib/supabase/session";
import { SYNTHETIC_ENTRIES } from "@/lib/synthetic-data";

export default async function HomePage() {
  const status = getIntegrationStatus();
  if (status.dataMode === "misconfigured") {
    return (
      <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-12 sm:px-8">
        <section className="soft-card p-6 sm:p-9" role="alert">
          <p className="eyebrow">設定が必要です</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--color-heading)]">
            Supabase本番モードを開始できません
          </h1>
          <p className="mt-3 text-[var(--color-secondary)]">
            HomeRelay専用のURLとpublishable keyを設定してください。合成デモへ自動で切り替えることはありません。
          </p>
        </section>
      </main>
    );
  }

  let context: HandoffRelayContext = DEMO_FAMILY_CONTEXT;
  let mode: RelayMode = "demo";
  if (status.dataMode === "supabase") {
    const session = await getCurrentSession();
    if (!session) redirect("/login");
    context = {
      householdId: session.member.householdId,
      member: {
        displayName: session.member.displayName,
        id: session.member.id,
        role: session.member.role,
      },
    };
    mode = "supabase";
  }

  return (
    <AuthSessionBoundary mode={mode}>
    <main className="mx-auto min-h-screen w-full max-w-7xl px-5 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-5 sm:px-8 sm:pt-7 lg:px-10 lg:pb-7">
      {mode === "demo" ? <DemoModeBanner /> : null}
      <IphoneInstallHint />

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
          <span className="hidden text-sm text-[var(--color-secondary)] sm:inline">
            {context.member.displayName}
          </span>
          <RoleBadge role={context.member.role} />
          {mode === "supabase" ? (
            <form action="/logout" method="post">
              <button className="secondary-button min-h-10 px-3 py-2 text-sm" type="submit">
                ログアウト
              </button>
            </form>
          ) : null}
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
        <RelayHomeFeed
          context={context}
          fixtureEntries={mode === "demo" ? SYNTHETIC_ENTRIES : []}
          key={`${context.householdId}:${context.member.id}`}
          mode={mode}
        />

        <aside className="soft-card hidden p-5 lg:sticky lg:top-6 lg:block lg:p-6" aria-labelledby="record-cta-title">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf4f1] text-[var(--color-primary)]">
            <Camera aria-hidden="true" size={25} />
          </span>
          <h2 className="mt-5 text-2xl font-semibold text-[var(--color-heading)]" id="record-cta-title">
            新しく伝える
          </h2>
          <p className="mt-2 text-base text-[var(--color-secondary)]">写真と声だけ。確認してから共有します。</p>
          <Link className="primary-button mt-6 w-full" href="/record?camera=1">
            <Camera aria-hidden="true" size={22} />
            カメラを開く
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
    </AuthSessionBoundary>
  );
}
