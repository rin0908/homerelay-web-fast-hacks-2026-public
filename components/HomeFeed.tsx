"use client";

import Link from "next/link";
import { AlertTriangle, Camera, HeartHandshake, RotateCcw } from "@/components/Icons";
import { EntryCard } from "@/components/EntryCard";
import type { HandoffEntry } from "@/types/handoff";

export type HomeFeedStatus = "ready" | "loading" | "empty" | "error";

export type HomeFeedProps = {
  entries: HandoffEntry[];
  status?: HomeFeedStatus;
  errorMessage?: string;
  captureHref?: string;
  onAcknowledge?: (entryId: string, action: "confirmed" | "claimed" | "done") => void;
  onClaimItem?: (entryId: string, itemId: string) => void;
  onCompleteItem?: (entryId: string, itemId: string) => void;
  busy?: boolean;
  currentMemberId?: string;
};

export function HomeFeed({
  entries,
  status = entries.length > 0 ? "ready" : "empty",
  errorMessage = "申し送りを読み込めませんでした。",
  captureHref = "/record",
  onAcknowledge,
  onClaimItem,
  onCompleteItem,
  busy = false,
  currentMemberId,
}: HomeFeedProps) {
  if (status === "loading") {
    return (
      <section aria-busy="true" aria-label="申し送りを読み込み中" className="space-y-4">
        <div className="h-6 w-36 animate-pulse rounded-full bg-[var(--color-divider)]" />
        <div className="aspect-[4/3] animate-pulse rounded-3xl bg-[#eeeae1] sm:aspect-[16/10]" />
        <div className="h-40 animate-pulse rounded-3xl bg-[var(--color-card)]" />
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="soft-card p-6 sm:p-8" role="alert">
        <AlertTriangle aria-hidden="true" className="text-[var(--color-warning)]" size={30} />
        <h2 className="mt-4 text-2xl font-semibold text-[var(--color-heading)]">うまく読み込めませんでした</h2>
        <p className="mt-2 text-base text-[var(--color-secondary)]">{errorMessage}</p>
        <Link className="secondary-button mt-5" href="/">
          <RotateCcw aria-hidden="true" size={19} />
          もう一度
        </Link>
      </section>
    );
  }

  if (status === "empty" || entries.length === 0) {
    return (
      <section className="soft-card px-6 py-12 text-center sm:px-10 sm:py-16">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#edf4f1] text-[var(--color-primary)]">
          <HeartHandshake aria-hidden="true" size={32} strokeWidth={1.7} />
        </span>
        <h2 className="mt-5 text-2xl font-semibold text-[var(--color-heading)]">最初の申し送りを始めましょう</h2>
        <p className="mx-auto mt-3 max-w-md text-base text-[var(--color-secondary)]">
          写真と声だけで、次の人へ伝えられます。
        </p>
        <Link className="primary-button mt-6 w-full sm:w-auto" href={captureHref}>
          <Camera aria-hidden="true" size={21} />
          写真を撮る
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {entries.map((entry, index) => (
        <EntryCard
          busy={busy}
          currentMemberId={currentMemberId}
          entry={entry}
          key={entry.id}
          onAcknowledge={onAcknowledge}
          onClaimItem={onClaimItem ? (itemId) => onClaimItem(entry.id, itemId) : undefined}
          onCompleteItem={onCompleteItem ? (itemId) => onCompleteItem(entry.id, itemId) : undefined}
          priority={index === 0}
        />
      ))}
    </div>
  );
}
