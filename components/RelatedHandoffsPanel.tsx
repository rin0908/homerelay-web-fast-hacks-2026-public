"use client";

import { useEffect, useId, useState } from "react";

import {
  AlertTriangle,
  Clock3,
  ShoppingBag,
  Sparkles,
} from "@/components/Icons";
import type { RelayMode } from "@/lib/relay/types";
import { SYNTHETIC_ENTRIES } from "@/lib/synthetic-data";
import type { HandoffEntry } from "@/types/handoff";

type SimilarHandoff = Readonly<{
  entryId: string;
  summary: string;
  createdAt: string;
  score: number;
}>;

type DuplicateItem = Readonly<{
  entryId: string;
  currentItemName: string;
  candidateItemName: string;
  createdAt: string;
  score: number;
}>;

type RelatedResponse = Readonly<{
  mode: "qdrant" | "unavailable";
  similarHandoffs: SimilarHandoff[];
  duplicateItems: DuplicateItem[];
}>;

type LiveState =
  | Readonly<{ entryId: null; status: "idle" }>
  | Readonly<{ entryId: string; status: "unavailable" }>
  | Readonly<{ entryId: string; status: "error" }>
  | Readonly<{
      data: RelatedResponse;
      entryId: string;
      status: "ready";
    }>;

export type RelatedHandoffsPanelProps = Readonly<{
  entry: HandoffEntry | null;
  mode: RelayMode;
}>;

const TOKYO_DATE = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Tokyo",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSimilarHandoff(value: unknown): value is SimilarHandoff {
  return (
    isRecord(value) &&
    typeof value.entryId === "string" &&
    typeof value.summary === "string" &&
    typeof value.createdAt === "string" &&
    isFiniteNumber(value.score)
  );
}

function isDuplicateItem(value: unknown): value is DuplicateItem {
  return (
    isRecord(value) &&
    typeof value.entryId === "string" &&
    typeof value.currentItemName === "string" &&
    typeof value.candidateItemName === "string" &&
    typeof value.createdAt === "string" &&
    isFiniteNumber(value.score)
  );
}

function parseRelatedResponse(value: unknown): RelatedResponse | null {
  if (
    !isRecord(value) ||
    (value.mode !== "qdrant" && value.mode !== "unavailable") ||
    !Array.isArray(value.similarHandoffs) ||
    !value.similarHandoffs.every(isSimilarHandoff) ||
    !Array.isArray(value.duplicateItems) ||
    !value.duplicateItems.every(isDuplicateItem)
  ) {
    return null;
  }

  return {
    mode: value.mode,
    similarHandoffs: value.similarHandoffs,
    duplicateItems: value.duplicateItems,
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日時不明" : TOKYO_DATE.format(date);
}

function formatScore(value: number): string {
  const percentage = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `一致度 ${percentage}%`;
}

function DemoDuplicateCandidate({ entry }: { entry: HandoffEntry | null }) {
  const fixtureEntry = SYNTHETIC_ENTRIES[0];
  const fixtureItem = fixtureEntry?.neededItems[0];
  const currentItem = entry?.neededItems[0] ?? fixtureItem;

  return (
    <div className="rounded-2xl border border-[#eadfc9] bg-[#fff8e9] p-4 sm:p-5">
      <p className="text-sm font-semibold text-[#76522f]">
        合成候補（Qdrant未接続）
      </p>
      {currentItem && fixtureItem && fixtureEntry ? (
        <div className="mt-3 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--color-warning)]">
            <ShoppingBag aria-hidden="true" size={21} />
          </span>
          <div>
            <p className="font-semibold text-[var(--color-heading)]">
              {currentItem.name}
            </p>
            <p className="mt-1 text-sm text-[var(--color-secondary)]">
              合成データ内の「{fixtureItem.name}」を重複候補として表示しています。
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-secondary)]">
              <Clock3 aria-hidden="true" size={14} />
              {formatDate(fixtureEntry.createdAt)}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-secondary)]">
          合成データに必要品の候補はありません。
        </p>
      )}
      <p className="mt-3 text-xs text-[#76522f]">
        これは動作確認用の表示です。Qdrantの検索結果ではありません。
      </p>
    </div>
  );
}

function SimilarHandoffs({
  headingId,
  items,
}: {
  headingId: string;
  items: SimilarHandoff[];
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h3
        className="text-lg font-semibold text-[var(--color-heading)]"
        id={headingId}
      >
        類似する過去の申し送り
      </h3>
      <ul className="mt-3 grid gap-3">
        {items.map((item) => (
          <li
            className="rounded-2xl border border-[var(--color-divider)] bg-white p-4"
            key={item.entryId}
          >
            <p className="text-[var(--color-heading)]">{item.summary}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-secondary)]">
              <span className="flex items-center gap-1.5">
                <Clock3 aria-hidden="true" size={14} />
                {formatDate(item.createdAt)}
              </span>
              <span>{formatScore(item.score)}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DuplicateItems({
  headingId,
  items,
}: {
  headingId: string;
  items: DuplicateItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h3
        className="text-lg font-semibold text-[var(--color-heading)]"
        id={headingId}
      >
        必要品の重複候補
      </h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li
            className="rounded-2xl border border-[#eadfc9] bg-[#fff8e9] p-4"
            key={`${item.entryId}-${item.currentItemName}-${item.candidateItemName}`}
          >
            <div className="flex items-start gap-3">
              <ShoppingBag
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-[var(--color-warning)]"
                size={21}
              />
              <div>
                <p className="font-semibold text-[var(--color-heading)]">
                  {item.currentItemName}
                </p>
                <p className="mt-1 text-sm text-[var(--color-secondary)]">
                  過去の候補: {item.candidateItemName}
                </p>
                <p className="mt-2 text-xs text-[var(--color-secondary)]">
                  {formatDate(item.createdAt)}・{formatScore(item.score)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RelatedHandoffsPanel({
  entry,
  mode,
}: RelatedHandoffsPanelProps) {
  const headingId = useId();
  const entryId = entry?.id ?? null;
  const [liveState, setLiveState] = useState<LiveState>({
    entryId: null,
    status: "idle",
  });

  useEffect(() => {
    if (mode !== "supabase" || !entryId) return;

    const controller = new AbortController();
    let active = true;

    void fetch(`/api/entries/${encodeURIComponent(entryId)}/related`, {
      headers: { Accept: "application/json" },
      method: "GET",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("RELATED_REQUEST_FAILED");
        const parsed = parseRelatedResponse(await response.json());
        if (!parsed) throw new Error("RELATED_RESPONSE_INVALID");
        if (!active) return;

        setLiveState(
          parsed.mode === "unavailable"
            ? { entryId, status: "unavailable" }
            : { data: parsed, entryId, status: "ready" },
        );
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setLiveState({ entryId, status: "error" });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [entryId, mode]);

  let content;
  if (mode === "demo") {
    content = <DemoDuplicateCandidate entry={entry} />;
  } else if (!entryId) {
    content = (
      <p className="text-sm text-[var(--color-secondary)]">
        申し送りを選ぶと、関連候補を表示します。
      </p>
    );
  } else if (liveState.entryId !== entryId) {
    content = (
      <div
        aria-busy="true"
        aria-live="polite"
        className="rounded-2xl bg-[#edf4f1] p-4 text-sm font-semibold text-[var(--color-primary)]"
        role="status"
      >
        関連候補を探しています…
      </div>
    );
  } else if (liveState.status === "unavailable") {
    content = (
      <div
        className="rounded-2xl border border-[#eadfc9] bg-[#fff8e9] p-4"
        role="status"
      >
        <p className="flex items-start gap-2 font-semibold text-[#76522f]">
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={19} />
          Qdrantは未接続、または一時的に利用できません。
        </p>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          申し送りの共有はそのまま続けられます。
        </p>
      </div>
    );
  } else if (liveState.status === "error") {
    content = (
      <div
        className="rounded-2xl border border-[#eadfc9] bg-[#fff8e9] p-4"
        role="status"
      >
        <p className="font-semibold text-[#76522f]">
          関連候補を取得できませんでした。
        </p>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          申し送りの共有には影響ありません。
        </p>
      </div>
    );
  } else if (liveState.status === "ready") {
    const { duplicateItems, similarHandoffs } = liveState.data;
    content =
      duplicateItems.length === 0 && similarHandoffs.length === 0 ? (
        <p
          className="rounded-2xl bg-[#edf4f1] p-4 text-sm text-[var(--color-secondary)]"
          role="status"
        >
          Qdrantで検索しましたが、関連候補は見つかりませんでした。
        </p>
      ) : (
        <div className="space-y-5">
          <p className="inline-flex rounded-full bg-[#edf4f1] px-3 py-1 text-xs font-semibold text-[var(--color-primary)]">
            Qdrant検索結果
          </p>
          <SimilarHandoffs
            headingId={`${headingId}-similar`}
            items={similarHandoffs}
          />
          <DuplicateItems
            headingId={`${headingId}-duplicates`}
            items={duplicateItems}
          />
        </div>
      );
  } else {
    content = null;
  }

  return (
    <section aria-labelledby={headingId} className="soft-card p-5 sm:p-6">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#edf4f1] text-[var(--color-primary)]">
          <Sparkles aria-hidden="true" size={23} />
        </span>
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-heading)]" id={headingId}>
            関連する申し送り
          </h2>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            過去の似た内容と、必要品の重複候補を確認できます。
          </p>
        </div>
      </header>
      {content}
    </section>
  );
}

export default RelatedHandoffsPanel;
