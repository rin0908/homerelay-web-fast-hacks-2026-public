import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_ENTRIES_CHANNEL_NAME,
  DEMO_ENTRIES_STORAGE_KEY,
  publishDemoEntry,
  readDemoEntries,
  subscribeDemoEntries,
  writeDemoEntries,
} from "@/lib/demo-relay";
import type { HandoffEntry } from "@/types/handoff";

type MessageListener = (event: MessageEvent<unknown>) => void;

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  readonly close = vi.fn();
  readonly listeners = new Set<MessageListener>();
  readonly postMessage = vi.fn();

  constructor(readonly name: string) {
    MockBroadcastChannel.instances.push(this);
  }

  addEventListener(_type: "message", listener: EventListenerOrEventListenerObject) {
    this.listeners.add(listener as MessageListener);
  }

  removeEventListener(
    _type: "message",
    listener: EventListenerOrEventListenerObject,
  ) {
    this.listeners.delete(listener as MessageListener);
  }

  emit(data: unknown) {
    const event = { data } as MessageEvent<unknown>;
    for (const listener of this.listeners) listener(event);
  }
}

function entry(id: string, createdAt = "2026-08-27T09:00:00.000Z"): HandoffEntry {
  return {
    id,
    householdId: "synthetic-household",
    author: {
      id: "synthetic-helper",
      displayName: "デモヘルパー さくら",
      role: "helper",
    },
    photoUrl: "/demo/synthetic-meal.png",
    photoAlt: "架空の昼食の写真",
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "夕方に水分をご確認ください",
    status: "confirmed",
    neededItems: [],
    createdAt,
  };
}

const originalBroadcastChannel = window.BroadcastChannel;

describe("demo relay", () => {
  beforeEach(() => {
    localStorage.clear();
    MockBroadcastChannel.instances = [];
    Object.defineProperty(window, "BroadcastChannel", {
      configurable: true,
      value: MockBroadcastChannel,
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(window, "BroadcastChannel", {
      configurable: true,
      value: originalBroadcastChannel,
    });
  });

  it("returns an empty list for absent, malformed, or non-array storage", () => {
    expect(readDemoEntries()).toEqual([]);

    localStorage.setItem(DEMO_ENTRIES_STORAGE_KEY, "{not-json");
    expect(readDemoEntries()).toEqual([]);

    localStorage.setItem(DEMO_ENTRIES_STORAGE_KEY, JSON.stringify({ id: "x" }));
    expect(readDemoEntries()).toEqual([]);
  });

  it("keeps at most ten entries and notifies the HomeRelay channel on write", () => {
    const entries = Array.from({ length: 12 }, (_, index) => entry(String(index)));

    writeDemoEntries(entries);

    expect(readDemoEntries().map((current) => current.id)).toEqual(
      entries.slice(0, 10).map((current) => current.id),
    );
    const publisher = MockBroadcastChannel.instances.at(-1);
    expect(publisher?.name).toBe(DEMO_ENTRIES_CHANNEL_NAME);
    expect(publisher?.postMessage).toHaveBeenCalledWith({
      key: DEMO_ENTRIES_STORAGE_KEY,
      type: "entries-changed",
    });
    expect(publisher?.close).toHaveBeenCalledTimes(1);
  });

  it("publishes newest first, replaces a duplicate id, and preserves the cap", () => {
    const existing = Array.from({ length: 10 }, (_, index) =>
      entry(String(index)),
    );
    writeDemoEntries(existing);

    publishDemoEntry(entry("4", "2026-08-27T10:00:00.000Z"));

    const stored = readDemoEntries();
    expect(stored).toHaveLength(10);
    expect(stored[0]).toMatchObject({
      createdAt: "2026-08-27T10:00:00.000Z",
      id: "4",
    });
    expect(stored.filter((current) => current.id === "4")).toHaveLength(1);
  });

  it("subscribes to both broadcast and storage updates and fully unsubscribes", () => {
    const callback = vi.fn();
    localStorage.setItem(
      DEMO_ENTRIES_STORAGE_KEY,
      JSON.stringify([entry("broadcast")]),
    );

    const unsubscribe = subscribeDemoEntries(callback);
    const subscriber = MockBroadcastChannel.instances[0];
    expect(subscriber?.name).toBe(DEMO_ENTRIES_CHANNEL_NAME);

    subscriber?.emit({
      key: DEMO_ENTRIES_STORAGE_KEY,
      type: "entries-changed",
    });
    expect(callback).toHaveBeenLastCalledWith([entry("broadcast")]);

    const storageEntries = [entry("storage")];
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DEMO_ENTRIES_STORAGE_KEY,
        newValue: JSON.stringify(storageEntries),
        storageArea: localStorage,
      }),
    );
    expect(callback).toHaveBeenLastCalledWith(storageEntries);

    unsubscribe();
    expect(subscriber?.close).toHaveBeenCalledTimes(1);
    const callsAfterUnsubscribe = callback.mock.calls.length;
    subscriber?.emit({
      key: DEMO_ENTRIES_STORAGE_KEY,
      type: "entries-changed",
    });
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DEMO_ENTRIES_STORAGE_KEY,
        newValue: "[]",
      }),
    );
    expect(callback).toHaveBeenCalledTimes(callsAfterUnsubscribe);
  });

  it("is safe to call without a browser window", () => {
    vi.stubGlobal("window", undefined);

    expect(readDemoEntries()).toEqual([]);
    expect(() => writeDemoEntries([entry("ssr")])).not.toThrow();
    expect(() => publishDemoEntry(entry("ssr"))).not.toThrow();
    expect(() => subscribeDemoEntries(vi.fn())()).not.toThrow();

    vi.unstubAllGlobals();
  });
});
