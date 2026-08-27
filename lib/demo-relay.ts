import type { HandoffEntry } from "@/types/handoff";

export const DEMO_ENTRIES_STORAGE_KEY = "homerelay:demo:entries:v1";
export const DEMO_ENTRIES_CHANNEL_NAME = "homerelay:demo:entries-channel:v1";

const MAX_DEMO_ENTRIES = 10;
const ENTRIES_CHANGED_MESSAGE = "entries-changed";

type DemoRelayMessage = {
  key: typeof DEMO_ENTRIES_STORAGE_KEY;
  type: typeof ENTRIES_CHANGED_MESSAGE;
};

export type DemoEntriesSubscriber = (entries: HandoffEntry[]) => void;

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseEntries(value: string | null): HandoffEntry[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? (parsed as HandoffEntry[]).slice(0, MAX_DEMO_ENTRIES)
      : [];
  } catch {
    return [];
  }
}

function createChannel(): BroadcastChannel | null {
  if (
    typeof window === "undefined" ||
    typeof window.BroadcastChannel !== "function"
  ) {
    return null;
  }

  return new window.BroadcastChannel(DEMO_ENTRIES_CHANNEL_NAME);
}

function notifyOtherTabs() {
  const channel = createChannel();
  if (!channel) return;

  const message: DemoRelayMessage = {
    key: DEMO_ENTRIES_STORAGE_KEY,
    type: ENTRIES_CHANGED_MESSAGE,
  };
  channel.postMessage(message);
  channel.close();
}

export function readDemoEntries(): HandoffEntry[] {
  const storage = browserStorage();
  if (!storage) return [];

  try {
    return parseEntries(storage.getItem(DEMO_ENTRIES_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeDemoEntries(entries: readonly HandoffEntry[]): void {
  const storage = browserStorage();
  if (!storage) return;

  const limitedEntries = entries.slice(0, MAX_DEMO_ENTRIES);
  storage.setItem(DEMO_ENTRIES_STORAGE_KEY, JSON.stringify(limitedEntries));
  notifyOtherTabs();
}

export function publishDemoEntry(entry: HandoffEntry): void {
  const entriesWithoutDuplicate = readDemoEntries().filter(
    (current) => current.id !== entry.id,
  );
  writeDemoEntries([entry, ...entriesWithoutDuplicate]);
}

export function subscribeDemoEntries(
  callback: DemoEntriesSubscriber,
): () => void {
  if (typeof window === "undefined") return () => {};

  const channel = createChannel();
  const handleBroadcast = (event: MessageEvent<unknown>) => {
    const message = event.data as Partial<DemoRelayMessage> | null;
    if (
      message?.type === ENTRIES_CHANGED_MESSAGE &&
      message.key === DEMO_ENTRIES_STORAGE_KEY
    ) {
      callback(readDemoEntries());
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DEMO_ENTRIES_STORAGE_KEY) {
      callback(parseEntries(event.newValue));
    }
  };

  channel?.addEventListener("message", handleBroadcast);
  window.addEventListener("storage", handleStorage);

  return () => {
    channel?.removeEventListener("message", handleBroadcast);
    channel?.close();
    window.removeEventListener("storage", handleStorage);
  };
}
