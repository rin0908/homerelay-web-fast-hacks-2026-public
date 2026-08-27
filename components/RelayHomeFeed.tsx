"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { HomeFeed, type HomeFeedStatus } from "@/components/HomeFeed";
import { RelatedHandoffsPanel } from "@/components/RelatedHandoffsPanel";
import { createDemoRelay } from "@/lib/relay/demo";
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

function mergeFixtures(entries: HandoffEntry[], fixtures: HandoffEntry[]) {
  const ids = new Set(entries.map((entry) => entry.id));
  return [...entries, ...fixtures.filter((entry) => !ids.has(entry.id))];
}

export function RelayHomeFeed({
  context,
  fixtureEntries = [],
  mode,
}: RelayHomeFeedProps) {
  const [entries, setEntries] = useState<HandoffEntry[]>(
    mode === "demo" ? fixtureEntries : [],
  );
  const [status, setStatus] = useState<HomeFeedStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const entriesRef = useRef(entries);
  const requestGeneration = useRef(0);
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

  useEffect(() => {
    let active = true;
    if (!relay) return;

    const normalize = (next: HandoffEntry[]) =>
      mode === "demo" ? mergeFixtures(next, fixtureEntries) : next;
    const accept = (next: HandoffEntry[]) => {
      if (!active) return;
      const normalized = normalize(next);
      entriesRef.current = normalized;
      setEntries(normalized);
      setStatus(normalized.length > 0 ? "ready" : "empty");
      setErrorMessage(null);
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
  }, [fixtureEntries, mode, relay]);

  async function refreshAfter(action: () => Promise<void>) {
    if (!relay || busy) return;
    setBusy(true);
    setErrorMessage(null);
    const generation = ++requestGeneration.current;
    try {
      await action();
      const next = await relay.list();
      const normalized =
        mode === "demo" ? mergeFixtures(next, fixtureEntries) : next;
      if (generation === requestGeneration.current) {
        entriesRef.current = normalized;
        setEntries(normalized);
        setStatus(normalized.length > 0 ? "ready" : "empty");
      }
    } catch {
      setErrorMessage("更新できませんでした。表示内容を保ったまま、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  function acknowledge(entryId: string, action: EntryStatus) {
    if (!relay) return;
    const operation =
      action === "confirmed"
        ? () => relay.acknowledge(entryId)
        : action === "claimed"
          ? () => relay.claimEntry(entryId)
          : () => relay.completeEntry(entryId);
    void refreshAfter(operation);
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
      {entries.length > 0 ? (
        <div className="mb-6">
          <RelatedHandoffsPanel entry={entries[0]} mode={mode} />
        </div>
      ) : null}
      <HomeFeed
        busy={busy}
        currentMemberId={context.member.id}
        entries={entries}
        errorMessage={errorMessage ?? undefined}
        onAcknowledge={acknowledge}
        onClaimItem={(_entryId, itemId) => {
          if (relay) void refreshAfter(() => relay.claimItem(itemId));
        }}
        onCompleteItem={(_entryId, itemId) => {
          if (relay) void refreshAfter(() => relay.completeItem(itemId));
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
