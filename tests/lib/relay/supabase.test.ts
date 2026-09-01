import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SupabaseRelay,
  SupabaseRelayError,
  type SupabaseListEntryRow,
} from "@/lib/relay/supabase";
import type { PublishHandoffInput } from "@/lib/relay/types";

const householdId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const itemId = "30000000-0000-4000-8000-000000000001";
const idempotencyKey = "40000000-0000-4000-8000-000000000001";
const signedPhotoUrl = "https://example.test/private-photo?token=synthetic";

type ChangeCallback = () => void;

function listRow(): SupabaseListEntryRow {
  return {
    id: entryId,
    household_id: householdId,
    author: {
      id: "50000000-0000-4000-8000-000000000001",
      display_name: "デモヘルパー さくら",
      role: "helper",
    },
    action_by: null,
    photo_path: `${householdId}/helper/${idempotencyKey}.jpg`,
    photo_alt: "架空の昼食の写真",
    condition_summary: "昼食は半分ほど召し上がりました",
    completed_summary: "水分を用意しました",
    next_request: "夕方に水分をご確認ください",
    status: "confirmed",
    needed_items: [
      {
        id: itemId,
        name: "トイレットペーパー",
        status: "purchase_intent",
        claimed_by: {
          id: "50000000-0000-4000-8000-000000000003",
          display_name: "デモ親族 ひなた",
          role: "relative",
        },
        updated_at: "2026-08-27T10:00:00.000Z",
      },
    ],
    acknowledgements: [
      {
        action: "confirmed",
        created_at: "2026-08-27T10:01:00.000Z",
        member: {
          id: "50000000-0000-4000-8000-000000000002",
          display_name: "デモ家族 あおい",
          role: "family",
        },
      },
    ],
    created_at: "2026-08-27T09:00:00.000Z",
  };
}

function publishInput(): PublishHandoffInput {
  return {
    idempotencyKey,
    photo: new Blob(["synthetic-photo"], { type: "image/jpeg" }),
    photoAlt: "架空の昼食の写真",
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "夕方に水分をご確認ください",
    neededItems: ["トイレットペーパー", "麦茶"],
  };
}

function createHarness(rows: SupabaseListEntryRow[] = [listRow()]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: rows, error: null });

  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: signedPhotoUrl },
    error: null,
  });
  const callbacks = new Map<string, ChangeCallback>();
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockImplementation(
    (
      _kind: string,
      config: { table: string },
      callback: ChangeCallback,
    ) => {
      callbacks.set(config.table, callback);
      return channel;
    },
  );
  channel.subscribe.mockReturnValue(channel);

  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const removeChannel = vi.fn().mockResolvedValue("ok");
  const from = vi.fn().mockReturnValue(query);
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrl });
  const realtimeChannel = vi.fn().mockReturnValue(channel);
  const client = {
    channel: realtimeChannel,
    from,
    removeChannel,
    rpc,
    storage: { from: storageFrom },
  } as unknown as SupabaseClient;

  return {
    callbacks,
    channel,
    client,
    createSignedUrl,
    from,
    query,
    realtimeChannel,
    removeChannel,
    rpc,
    storageFrom,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SupabaseRelay", () => {
  it("lists nested household rows and maps private signed photo URLs", async () => {
    const harness = createHarness();
    const relay = new SupabaseRelay(harness.client, { householdId });

    await expect(relay.list()).resolves.toEqual([
      {
        id: entryId,
        householdId,
        author: {
          id: "50000000-0000-4000-8000-000000000001",
          displayName: "デモヘルパー さくら",
          role: "helper",
        },
        photoUrl: signedPhotoUrl,
        photoAlt: "架空の昼食の写真",
        conditionSummary: "昼食は半分ほど召し上がりました",
        completedSummary: "水分を用意しました",
        nextRequest: "夕方に水分をご確認ください",
        status: "confirmed",
        actionBy: {
          id: "50000000-0000-4000-8000-000000000002",
          displayName: "デモ家族 あおい",
          role: "family",
        },
        neededItems: [
          {
            id: itemId,
            name: "トイレットペーパー",
            status: "purchase_intent",
            claimedBy: {
              id: "50000000-0000-4000-8000-000000000003",
              displayName: "デモ親族 ひなた",
              role: "relative",
            },
            updatedAt: "2026-08-27T10:00:00.000Z",
          },
        ],
        createdAt: "2026-08-27T09:00:00.000Z",
      },
    ]);

    expect(harness.from).toHaveBeenCalledWith("entries");
    expect(harness.query.select).toHaveBeenCalledWith(
      expect.stringContaining("acknowledgements"),
    );
    expect(harness.query.eq).toHaveBeenCalledWith("household_id", householdId);
    expect(harness.query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(harness.query.limit).toHaveBeenCalledWith(10);
    expect(harness.storageFrom).toHaveBeenCalledWith("handoff-photos");
    expect(harness.createSignedUrl).toHaveBeenCalledWith(
      listRow().photo_path,
      300,
    );
  });

  it("posts the formal publish FormData contract and returns entryId", async () => {
    const harness = createHarness();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entryId }), {
        headers: { "Content-Type": "application/json" },
        status: 201,
      }),
    );
    const relay = new SupabaseRelay(
      harness.client,
      { householdId },
      { actionBatchMs: 0, fetch: fetchMock },
    );
    const input = publishInput();

    await expect(relay.publish(input)).resolves.toBe(entryId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/entries");
    expect(init).toMatchObject({ method: "POST" });
    const body = init.body as FormData;
    expect(body.get("idempotencyKey")).toBe(idempotencyKey);
    expect(body.get("photo")).toBeInstanceOf(Blob);
    expect(body.get("photoAlt")).toBe(input.photoAlt);
    expect(body.get("conditionSummary")).toBe(input.conditionSummary);
    expect(body.get("completedSummary")).toBe(input.completedSummary);
    expect(body.get("nextRequest")).toBe(input.nextRequest);
    expect(JSON.parse(String(body.get("neededItems")))).toEqual(input.neededItems);
  });

  it("posts each guarded transition to the authenticated server route", async () => {
    const harness = createHarness();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const relay = new SupabaseRelay(
      harness.client,
      { householdId },
      { fetch: fetchMock },
    );

    await relay.acknowledge(entryId);
    await relay.claimEntry(entryId);
    await relay.completeEntry(entryId);
    await relay.claimItem(itemId);
    await relay.completeItem(itemId);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls.map(([url, init]) => [
        url,
        JSON.parse(String(init?.body)),
      ]),
    ).toEqual([
      ["/api/actions", { actions: [{ action: "acknowledge_entry", targetId: entryId }] }],
      ["/api/actions", { actions: [{ action: "claim_entry", targetId: entryId }] }],
      ["/api/actions", { actions: [{ action: "complete_entry", targetId: entryId }] }],
      ["/api/actions", { actions: [{ action: "claim_needed_item", targetId: itemId }] }],
      ["/api/actions", { actions: [{ action: "complete_needed_item", targetId: itemId }] }],
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    }
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("batches rapid guarded transitions into one keepalive request", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const relay = new SupabaseRelay(
      harness.client,
      { householdId },
      { actionBatchMs: 650, fetch: fetchMock },
    );

    const pending = [
      relay.acknowledge(entryId),
      relay.claimEntry(entryId),
      relay.completeEntry(entryId),
      relay.claimItem(itemId),
      relay.completeItem(itemId),
    ];
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(pending);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      actions: [
        { action: "acknowledge_entry", targetId: entryId },
        { action: "claim_entry", targetId: entryId },
        { action: "complete_entry", targetId: entryId },
        { action: "claim_needed_item", targetId: itemId },
        { action: "complete_needed_item", targetId: itemId },
      ],
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      keepalive: true,
      method: "POST",
    });
    vi.useRealTimers();
  });

  it("rejects every queued transition when a batched request fails", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 409 }));
    const relay = new SupabaseRelay(
      harness.client,
      { householdId },
      { actionBatchMs: 650, fetch: fetchMock },
    );

    const pending = [
      relay.acknowledge(entryId),
      relay.claimEntry(entryId),
      relay.completeEntry(entryId),
    ];
    const settled = Promise.allSettled(pending);
    await vi.advanceTimersByTimeAsync(650);

    const results = await settled;
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "ACTION_FAILED" });
      }
    }
  });

  it("serializes a second flush behind an in-flight action request", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValue(new Response(null, { status: 204 }));
    const relay = new SupabaseRelay(
      harness.client,
      { householdId },
      { actionBatchMs: 650, fetch: fetchMock },
    );

    const claim = relay.claimItem(itemId);
    await vi.advanceTimersByTimeAsync(650);
    expect(fetchMock).toHaveBeenCalledOnce();

    const complete = relay.completeItem(itemId);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();

    releaseFirst(new Response(null, { status: 204 }));
    await claim;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await complete;
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        JSON.parse(String(init?.body)).actions[0].action,
      ),
    ).toEqual(["claim_needed_item", "complete_needed_item"]);
  });

  it("flushes a queued keepalive action before the page is hidden", async () => {
    const harness = createHarness();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const relay = new SupabaseRelay(
      harness.client,
      { householdId },
      { actionBatchMs: 60_000, fetch: fetchMock },
    );
    const unsubscribe = relay.subscribe(vi.fn());

    const pending = relay.acknowledge(entryId);
    window.dispatchEvent(new Event("pagehide"));
    await pending;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
    unsubscribe();
  });

  it("debounces three household Realtime tables into one fresh list", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const callback = vi.fn();
    const relay = new SupabaseRelay(
      harness.client,
      { householdId },
      { debounceMs: 120 },
    );

    const unsubscribe = relay.subscribe(callback);

    expect([...harness.callbacks.keys()]).toEqual([
      "entries",
      "needed_items",
      "acknowledgements",
    ]);
    for (const trigger of harness.callbacks.values()) trigger();
    await vi.advanceTimersByTimeAsync(119);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(harness.query.limit).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(harness.removeChannel).toHaveBeenCalledWith(harness.channel);
  });

  it("surfaces live publish and RPC errors without writing demo storage", async () => {
    const harness = createHarness();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    harness.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    const relay = new SupabaseRelay(
      harness.client,
      { householdId },
      { fetch: fetchMock },
    );
    localStorage.setItem("homerelay:demo:entries:v1", "sentinel");

    await expect(relay.publish(publishInput())).rejects.toMatchObject({
      code: "PUBLISH_FAILED",
    });
    await expect(relay.claimEntry(entryId)).rejects.toBeInstanceOf(
      SupabaseRelayError,
    );
    expect(localStorage.getItem("homerelay:demo:entries:v1")).toBe("sentinel");
  });
});
