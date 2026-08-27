import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ENTRIES_STORAGE_KEY } from "@/lib/demo-relay";
import { createDemoRelay, DemoRelay } from "@/lib/relay/demo";
import type { PublishHandoffInput } from "@/lib/relay/types";
import type { HandoffEntry, MemberSummary } from "@/types/handoff";

const householdId = "synthetic-household";
const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const itemId = `${idempotencyKey}-item-0`;
const member: MemberSummary = {
  id: "synthetic-family-member",
  displayName: "デモ家族 あおい",
  role: "family",
};
const author: MemberSummary = {
  id: "synthetic-helper-member",
  displayName: "デモヘルパー さくら",
  role: "helper",
};
const fixedNow = "2026-08-27T10:15:00.000Z";
const photoDataUrl = "data:image/jpeg;base64,c3ludGhldGlj";

function publishInput(): PublishHandoffInput {
  return {
    idempotencyKey,
    photo: new Blob(["synthetic-photo"], { type: "image/jpeg" }),
    photoAlt: "架空の昼食の写真",
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "夕方に水分をご確認ください",
    neededItems: ["トイレットペーパー"],
  };
}

function storedEntry(id = idempotencyKey): HandoffEntry {
  return {
    id,
    householdId,
    author,
    photoUrl: photoDataUrl,
    photoAlt: "架空の昼食の写真",
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "夕方に水分をご確認ください",
    status: "confirmed",
    neededItems: [
      {
        id: itemId,
        name: "トイレットペーパー",
        status: "needed",
        updatedAt: fixedNow,
      },
    ],
    createdAt: fixedNow,
  };
}

function store(entries: HandoffEntry[]) {
  localStorage.setItem(DEMO_ENTRIES_STORAGE_KEY, JSON.stringify(entries));
}

function relayOptions() {
  return {
    encodePhoto: vi.fn().mockResolvedValue(photoDataUrl),
    now: () => fixedNow,
  };
}

describe("DemoRelay", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "BroadcastChannel", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("lists existing demo entries through the shared relay contract", async () => {
    const entries = [storedEntry()];
    store(entries);
    const relay = createDemoRelay({ householdId, member });

    expect(relay.mode).toBe("demo");
    await expect(relay.list()).resolves.toEqual(entries);
  });

  it("encodes a Blob, persists a confirmed entry, and returns its entry id", async () => {
    const options = relayOptions();
    const relay = new DemoRelay({ householdId, member }, options);
    const input = publishInput();

    await expect(relay.publish(input)).resolves.toBe(idempotencyKey);

    expect(options.encodePhoto).toHaveBeenCalledWith(input.photo);
    await expect(relay.list()).resolves.toEqual([
      {
        ...storedEntry(),
        author: member,
      },
    ]);
  });

  it("uses the browser FileReader to store a Blob as a data URL", async () => {
    const relay = new DemoRelay(
      { householdId, member },
      { now: () => fixedNow },
    );

    await relay.publish(publishInput());

    expect((await relay.list())[0]?.photoUrl).toMatch(
      /^data:image\/jpeg;base64,/,
    );
  });

  it("returns the first entry for a repeated idempotency key without re-encoding", async () => {
    const options = relayOptions();
    const relay = new DemoRelay({ householdId, member }, options);

    await relay.publish(publishInput());
    await expect(relay.publish(publishInput())).resolves.toBe(idempotencyKey);

    expect(options.encodePhoto).toHaveBeenCalledTimes(1);
    await expect(relay.list()).resolves.toHaveLength(1);
  });

  it("supports attributable acknowledge, claim, and complete entry actions", async () => {
    store([storedEntry()]);
    const relay = createDemoRelay({ householdId, member });

    await relay.acknowledge(idempotencyKey);
    expect((await relay.list())[0]).toMatchObject({
      actionBy: member,
      status: "confirmed",
    });

    await relay.claimEntry(idempotencyKey);
    expect((await relay.list())[0]).toMatchObject({
      actionBy: member,
      status: "claimed",
    });

    await relay.completeEntry(idempotencyKey);
    expect((await relay.list())[0]).toMatchObject({
      actionBy: member,
      status: "done",
    });
  });

  it("claims and completes only valid needed-item transitions", async () => {
    store([storedEntry()]);
    const relay = createDemoRelay(
      { householdId, member },
      { now: () => fixedNow },
    );

    await relay.completeItem(itemId);
    expect((await relay.list())[0]?.neededItems[0]?.status).toBe("needed");

    await relay.claimItem(itemId);
    expect((await relay.list())[0]?.neededItems[0]).toEqual(
      expect.objectContaining({
        claimedBy: member,
        status: "purchase_intent",
        updatedAt: fixedNow,
      }),
    );

    await relay.completeItem(itemId);
    expect((await relay.list())[0]?.neededItems[0]).toEqual(
      expect.objectContaining({
        claimedBy: member,
        status: "purchased",
        updatedAt: fixedNow,
      }),
    );
  });

  it("delegates subscriptions and removes the storage listener", () => {
    const relay = createDemoRelay({ householdId, member });
    const callback = vi.fn();
    const unsubscribe = relay.subscribe(callback);
    const entries = [storedEntry("storage-event")];

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DEMO_ENTRIES_STORAGE_KEY,
        newValue: JSON.stringify(entries),
        storageArea: localStorage,
      }),
    );
    expect(callback).toHaveBeenCalledWith(entries);

    unsubscribe();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DEMO_ENTRIES_STORAGE_KEY,
        newValue: "[]",
      }),
    );
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
