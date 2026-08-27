import Link from "next/link";
import { ArrowLeft, Camera, Check, Mic, Send } from "@/components/Icons";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { RecordFlow } from "@/components/RecordFlow";
import { getIntegrationStatus } from "@/lib/integration-status";

export default function RecordPlaceholderPage() {
  const status = getIntegrationStatus();

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-6 sm:px-8 sm:py-8">
      {status.appMode === "demo" ? <DemoModeBanner /> : null}
      <nav className="mt-6" aria-label="戻る">
        <Link
          className="inline-flex min-h-12 items-center gap-2 rounded-xl px-2 font-semibold text-[var(--color-primary)]"
          href="/"
        >
          <ArrowLeft aria-hidden="true" size={20} />
          今日の様子へ
        </Link>
      </nav>

      <header className="mt-6 sm:mt-8">
        <p className="eyebrow">新しい申し送り</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[var(--color-heading)] sm:text-4xl">
          写真と声で記録
        </h1>
        <p className="mt-3 max-w-2xl text-base text-[var(--color-secondary)] sm:text-lg">
          確認するまで、ほかの人には共有されません。
        </p>
      </header>

      <ol className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="記録の4ステップ">
        {[
          { label: "写真を撮る", icon: Camera },
          { label: "話す", icon: Mic },
          { label: "これでOK", icon: Check },
          { label: "次の人へ", icon: Send },
        ].map(({ label, icon: Icon }, index) => (
          <li
            className="flex min-h-14 items-center gap-2 rounded-2xl border border-[var(--color-divider)] bg-[var(--color-card)] px-3 text-sm font-semibold text-[var(--color-body)]"
            key={label}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#edf4f1] text-xs text-[var(--color-primary)]">
              {index + 1}
            </span>
            <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6">
        <RecordFlow />
      </div>
    </main>
  );
}
