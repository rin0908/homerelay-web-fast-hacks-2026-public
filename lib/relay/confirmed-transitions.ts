import type {
  EntryStatus,
  HandoffEntry,
  MemberSummary,
  NeededItemStatus,
} from "@/types/handoff";

export function applyConfirmedEntryAction(
  entries: HandoffEntry[],
  entryId: string,
  status: EntryStatus,
  member: MemberSummary,
): HandoffEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    changed = true;
    return { ...entry, actionBy: member, status };
  });
  return changed ? next : entries;
}

export function applyConfirmedItemAction(
  entries: HandoffEntry[],
  itemId: string,
  status: NeededItemStatus,
  member: MemberSummary,
  updatedAt: string,
): HandoffEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    let entryChanged = false;
    const neededItems = entry.neededItems.map((item) => {
      if (item.id !== itemId) return item;
      entryChanged = true;
      changed = true;
      return { ...item, claimedBy: member, status, updatedAt };
    });
    return entryChanged ? { ...entry, neededItems } : entry;
  });
  return changed ? next : entries;
}
