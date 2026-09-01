"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HomeFeed, type HomeFeedStatus } from "@/components/HomeFeed";
import { RelatedHandoffsPanel } from "@/components/RelatedHandoffsPanel";
import { createDemoRelay } from "@/lib/relay/demo";
import {
  applyConfirmedEntryAction,
  applyConfirmedItemAction,
} from "@/lib/relay/confirmed-transitions";
import { createSupabaseRelay } from "@/lib/relay/supabase";
import type {
  HandoffRelay,
  HandoffRelayContext,
  RelayMode,
} from "@/lib/relay/types";
import { createClient } from "@/lib/supabase/client";
import type { EntryStatus, HandoffEntry } from "@/types/handoff";

type RelayHomeFeedProps = {
  context: HandoffRelayContext;
  fixtureEntries?: HandoffEntry[];
  mode: RelayMode;
};

const EMPTY_FIXTURE_ENTRIES: HandoffEntry[] = [];

function mergeFixtures(entries: HandoffEntry[], fixtures: HandoffEntry[]) {
  const ids = new Set(entries.map((entry) => entry.id));
  return [...entries, ...fixtures.filter((entry) => !ids.has(entry.id))];
}

export function RelayHomeFeed({
  context,
  fixtureEntries = EMPTY_FIXTURE_ENTRIES,
  mode,
}: RelayHomeFeedProps) {
  const [entries, setEntries] = useState<HandoffEntry[]>(
    mode === "demo" ? fixtureEntries : [],
  );
  const [status, setStatus] = useState<HomeFeedStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState(0);
  const entriesRef = useRef(entries);
  const requestGeneration = useRef(0);
  const pendingActionsRef = useRef(0);
  const pendingEpochRef = useRef(0);
  const batchBaseEntriesRef = useRef<HandoffEntry[] | null>(null);
  const relay = useMemo<HandoffRelay | null>(() => {
    if (mode === "demo") return createDemoRelay(context);
    const client = createClient();
    return client
      ? createSupabaseRelay(
          client,
          { householdId: context.householdId },
          {
            onSubscriptionError: () => {
              setErrorMessage("リアルタイム接続を確認できません。再接続をお待ちください。");
              setStatus("error");
            },
          },
        )
      : null;
  }, [context, mode]);

  const commitEntries = useCallback((
    next: HandoffEntry[],
    { clearError = true }: { clearError?: boolean } = {},
  ) => {
    const normalized =
      mode === "demo" ? mergeFixtures(next, fixtureEntries) : next;
    entriesRef.current = normalized;
    setEntries(normalized);
    setStatus(normalized.length > 0 ? "ready" : "empty");
    if (clearError) setErrorMessage(null);
  }, [fixtureEntries, mode]);

  useEffect(() => {
    let active = true;
    if (!relay) return;

    const accept = (next: HandoffEntry[]) => {
      if (!active) return;
      if (pendingActionsRef.current > 0) return;
      commitEntries(next);
    };
    const fail = () => {
      if (!active) return;
      setErrorMessage("最新の申し送りを取得できませんでした。通信を確認して再試行してください。");
      if (entriesRef.current.length === 0) setStatus("error");
    };

    const initialGeneration = ++requestGeneration.current;
    void relay.list().then((next) => {
      if (initialGeneration === requestGeneration.current) accept(next);
    }, fail);
    const unsubscribe = relay.subscribe((next) => {
      requestGeneration.current += 1;
      accept(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [commitEntries, relay]);

  async function refreshFromSource({ preserveError = false } = {}) {
    if (!relay) return;
    const generation = ++requestGeneration.current;
    try {
      const next = await relay.list();
      if (
        generation === requestGeneration.current &&
        pendingActionsRef.current === 0
      ) {
        commitEntries(next, { clearError: !preserveError });
      }
    } catch {
      setErrorMessage("保存結果を読み直せませんでした。通信を確認してください。");
      if (entriesRef.current.length === 0) setStatus("error");
    }
  }

  function applyOptimistically(
    action: () => Promise<void>,
    applyLocal: (current: HandoffEntry[]) => HandoffEntry[],
  ) {
    if (!relay) return;
    const previous = entriesRef.current;
    const optimistic = applyLocal(previous);
    if (optimistic === previous) return;

    if (pendingActionsRef.current === 0) {
      batchBaseEntriesRef.current = previous;
    }
    const epoch = pendingEpochRef.current;
    pendingActionsRef.current += 1;
    setPendingActions(pendingActionsRef.current);
    entriesRef.current = optimistic;
    setEntries(optimistic);
    setStatus(optimistic.length > 0 ? "ready" : "empty");
    setErrorMessage(null);

    void action().then(
      () => {
        if (epoch !== pendingEpochRef.current) return;
        pendingActionsRef.current = Math.max(0, pendingActionsRef.current - 1);
        setPendingActions(pendingActionsRef.current);
        if (pendingActionsRef.current === 0) {
          batchBaseEntriesRef.current = null;
          void refreshFromSource();
        }
      },
      () => {
        if (epoch !== pendingEpochRef.current) return;
        pendingEpochRef.current += 1;
        pendingActionsRef.current = 0;
        setPendingActions(0);
        const fallback = batchBaseEntriesRef.current;
        batchBaseEntriesRef.current = null;
        if (fallback) {
          entriesRef.current = fallback;
          setEntries(fallback);
          setStatus(fallback.length > 0 ? "ready" : "empty");
        }
        setErrorMessage("更新できませんでした。最新の状態を読み直しています。");
        void refreshFromSource({ preserveError: true });
      },
    );
  }

  function acknowledge(entryId: string, action: EntryStatus) {
    if (!relay) return;
    const operation =
      action === "confirmed"
        ? () => relay.acknowledge(entryId)
        : action === "claimed"
          ? () => relay.claimEntry(entryId)
          : () => relay.completeEntry(entryId);
    applyOptimistically(operation, (current) =>
      applyConfirmedEntryAction(current, entryId, action, context.member),
    );
  }

  return (
    <section aria-labelledby="feed-heading">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold text-[var(--color-heading)]" id="feed-heading">
          新しい申し送り
        </h2>
        <span className="rounded-full bg-[#edf4f1] px-3 py-1 text-xs font-semibold text-[var(--color-primary)]">
          確認済み {entries.length}件
        </span>
      </div>
      {errorMessage && entries.length > 0 ? (
        <p className="mb-4 rounded-xl bg-[#fff4e7] p-3 text-sm font-semibold text-[#85572f]" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {pendingActions > 0 ? (
        <p
          aria-live="polite"
          className="mb-4 rounded-xl bg-[#edf5f1] p-3 text-sm font-semibold text-[var(--color-primary)]"
          role="status"
        >
          タップを受け付けました。安全に反映しています…
        </p>
      ) : null}
      <HomeFeed
        afterFirstEntry={
          entries.length > 0 ? (
            <RelatedHandoffsPanel entry={entries[0]} mode={mode} />
          ) : null
        }
        currentMemberId={context.member.id}
        entries={entries}
        errorMessage={errorMessage ?? undefined}
        onAcknowledge={acknowledge}
        onClaimItem={(_entryId, itemId) => {
          if (relay) {
            applyOptimistically(
              () => relay.claimItem(itemId),
              (current) =>
                applyConfirmedItemAction(
                  current,
                  itemId,
                  "purchase_intent",
                  context.member,
                  new Date().toISOString(),
                ),
            );
          }
        }}
        onCompleteItem={(_entryId, itemId) => {
          if (relay) {
            applyOptimistically(
              () => relay.completeItem(itemId),
              (current) =>
                applyConfirmedItemAction(
                  current,
                  itemId,
                  "purchased",
                  context.member,
                  new Date().toISOString(),
                ),
            );
          }
        }}
        status={
          relay
            ? status === "error" && entries.length > 0
              ? "ready"
              : status
            : "error"
        }
      />
    </section>
  );
}
