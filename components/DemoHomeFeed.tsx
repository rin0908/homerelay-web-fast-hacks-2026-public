"use client";

import { useEffect, useState } from "react";
import { HomeFeed } from "@/components/HomeFeed";
import { readDemoEntries, subscribeDemoEntries, writeDemoEntries } from "@/lib/demo-relay";
import type { HandoffEntry, MemberSummary } from "@/types/handoff";

const DEMO_FAMILY_MEMBER: MemberSummary = {
  id: "demo-family-aoi",
  displayName: "デモ家族 あおい",
  role: "family",
};

function mergeWithFixtures(stored: HandoffEntry[], fixtures: HandoffEntry[]) {
  const storedIds = new Set(stored.map((entry) => entry.id));
  return [...stored, ...fixtures.filter((entry) => !storedIds.has(entry.id))];
}

export function DemoHomeFeed({ initialEntries }: { initialEntries: HandoffEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);

  useEffect(() => {
    const refresh = (stored: HandoffEntry[]) => setEntries(mergeWithFixtures(stored, initialEntries));
    refresh(readDemoEntries());
    return subscribeDemoEntries(refresh);
  }, [initialEntries]);

  function updateEntries(update: (current: HandoffEntry[]) => HandoffEntry[]) {
    setEntries((current) => {
      const next = update(current);
      writeDemoEntries(next);
      return next;
    });
  }

  function acknowledge(entryId: string, action: "confirmed" | "claimed" | "done") {
    updateEntries((current) =>
      current.map((entry) =>
        entry.id === entryId ? { ...entry, status: action, actionBy: DEMO_FAMILY_MEMBER } : entry,
      ),
    );
  }

  function claimItem(entryId: string, itemId: string) {
    updateEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              neededItems: entry.neededItems.map((item) =>
                item.id === itemId && item.status === "needed"
                  ? {
                      ...item,
                      status: "purchase_intent" as const,
                      claimedBy: DEMO_FAMILY_MEMBER,
                      updatedAt: new Date().toISOString(),
                    }
                  : item,
              ),
            }
          : entry,
      ),
    );
  }

  function completeItem(entryId: string, itemId: string) {
    updateEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              neededItems: entry.neededItems.map((item) =>
                item.id === itemId && item.status === "purchase_intent"
                  ? { ...item, status: "purchased" as const, updatedAt: new Date().toISOString() }
                  : item,
              ),
            }
          : entry,
      ),
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
      <HomeFeed
        entries={entries}
        onAcknowledge={acknowledge}
        onClaimItem={claimItem}
        onCompleteItem={completeItem}
      />
    </section>
  );
}
