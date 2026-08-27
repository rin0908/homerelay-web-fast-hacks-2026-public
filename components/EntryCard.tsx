"use client";

import Image from "next/image";
import { Check, Clock3, ShieldCheck, UserRound } from "@/components/Icons";
import { NeededItemCard, type NeededItemCardProps } from "@/components/NeededItemCard";
import { RoleBadge } from "@/components/RoleBadge";
import type { HandoffEntry } from "@/types/handoff";

const TOKYO_DATE = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Tokyo",
});

type EntryCardProps = {
  entry: HandoffEntry;
  priority?: boolean;
  onAcknowledge?: (entryId: string, action: "confirmed" | "claimed" | "done") => void;
  onClaimItem?: NeededItemCardProps["onClaim"];
  onCompleteItem?: NeededItemCardProps["onComplete"];
  busy?: boolean;
};

export function EntryCard({
  entry,
  priority = false,
  onAcknowledge,
  onClaimItem,
  onCompleteItem,
  busy = false,
}: EntryCardProps) {
  return (
    <article className="soft-card overflow-hidden">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#eef1ec] sm:aspect-[16/10]">
        <Image
          alt={entry.photoAlt}
          className="object-cover"
          fill
          priority={priority}
          sizes="(max-width: 768px) 100vw, 760px"
          src={entry.photoUrl}
        />
        <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-[#fffdf9e8] px-3 py-2 text-xs font-semibold text-[var(--color-primary)] shadow-sm backdrop-blur">
          <ShieldCheck aria-hidden="true" size={16} />
          本人確認済み
        </span>
      </div>

      <div className="p-5 sm:p-7">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-divider)] pb-5">
          <div>
            <RoleBadge role={entry.author.role} />
            <p className="mt-2 font-semibold text-[var(--color-heading)]">{entry.author.displayName}</p>
          </div>
          <time
            className="flex items-center gap-1.5 text-sm text-[var(--color-secondary)]"
            dateTime={entry.createdAt}
          >
            <Clock3 aria-hidden="true" size={16} />
            {TOKYO_DATE.format(new Date(entry.createdAt))}
          </time>
        </header>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <section>
            <p className="text-xs font-semibold tracking-[0.08em] text-[var(--color-primary)]">今日のご様子</p>
            <p className="mt-2 text-[var(--color-heading)]">{entry.conditionSummary}</p>
          </section>
          <section>
            <p className="text-xs font-semibold tracking-[0.08em] text-[var(--color-primary)]">今日できたこと</p>
            <p className="mt-2 text-[var(--color-heading)]">{entry.completedSummary}</p>
          </section>
          <section className="sm:col-span-2">
            <p className="text-xs font-semibold tracking-[0.08em] text-[var(--color-primary)]">次の方へのお願い</p>
            <p className="mt-2 text-[var(--color-heading)]">{entry.nextRequest}</p>
          </section>
        </div>

        {entry.neededItems.length > 0 ? (
          <section className="mt-7 border-t border-[var(--color-divider)] pt-6" aria-labelledby={`needed-${entry.id}`}>
            <h3 className="text-xl font-semibold text-[var(--color-heading)]" id={`needed-${entry.id}`}>
              必要なもの
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {entry.neededItems.map((item) => (
                <NeededItemCard
                  busy={busy}
                  item={item}
                  key={item.id}
                  onClaim={onClaimItem}
                  onComplete={onCompleteItem}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-7 border-t border-[var(--color-divider)] pt-6" aria-label="申し送りへの対応">
          {entry.actionBy ? (
            <p className="mb-3 flex items-center gap-1.5 text-sm text-[var(--color-secondary)]">
              <UserRound aria-hidden="true" size={16} />
              {entry.actionBy.displayName}さんが更新しました
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { action: "confirmed" as const, label: "確認しました" },
              { action: "claimed" as const, label: "私が対応します" },
              { action: "done" as const, label: "対応しました" },
            ].map(({ action, label }) => {
              const active = entry.status === action;
              return (
                <button
                  aria-pressed={active}
                  className={active ? "primary-button w-full" : "secondary-button w-full"}
                  disabled={busy || !onAcknowledge}
                  key={action}
                  onClick={() => onAcknowledge?.(entry.id, action)}
                  type="button"
                >
                  {active ? <Check aria-hidden="true" size={18} /> : null}
                  {label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </article>
  );
}
