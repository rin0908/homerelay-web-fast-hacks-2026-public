import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createQdrantAdapter,
  deterministicQdrantPointId,
} from "@/lib/qdrant/adapter";
import type { QdrantClientLike } from "@/lib/qdrant/client";
import type { QdrantConfig } from "@/lib/qdrant/env";
import type { ConfirmedEntryForIndex } from "@/lib/qdrant/types";

const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";
const FOREIGN_HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000002";
const CURRENT_ENTRY_ID = "20000000-0000-4000-8000-000000000001";
const RELATED_ENTRY_IDS = [
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
  "20000000-0000-4000-8000-000000000005",
] as const;
const CREATED_AT = "2026-08-28T01:02:03.000Z";

const CONFIG: QdrantConfig = {
  apiKey: "synthetic-database-key",
  collection: "homerelay_entries",
  embeddingModel: "synthetic/multilingual-model",
  timeoutMs: 4_000,
  url: "https://synthetic.qdrant.io",
  vectorSize: 384,
};

const CONFIRMED_ENTRY: ConfirmedEntryForIndex = {
  completedSummary: "水分を用意しました",
  conditionSummary: "昼食は半分ほど召し上がりました",
  createdAt: CREATED_AT,
  entryId: CURRENT_ENTRY_ID,
  householdId: HOUSEHOLD_ID,
  neededItems: ["トイレットペーパー", "麦茶"],
  nextRequest: "次に訪れた方は水分をご確認ください",
};

function mockClient() {
  const query = vi.fn();
  const upsert = vi.fn();
  return {
    client: {
      query: query as unknown as QdrantClientLike["query"],
      upsert: upsert as unknown as QdrantClientLike["upsert"],
    },
    query,
    upsert,
  };
}

function point(
  entryId: string,
  options: {
    householdId?: string;
    text?: string;
    type?: "handoff" | "needed_item";
  } = {},
) {
  return {
    id: deterministicQdrantPointId(
      options.type ?? "handoff",
      entryId,
      options.text,
    ),
    payload: {
      created_at: CREATED_AT,
      display_text: options.text ?? `関連する申し送り ${entryId.slice(-1)}`,
      entry_id: entryId,
      household_id: options.householdId ?? HOUSEHOLD_ID,
      type: options.type ?? "handoff",
    },
    score: 0.91,
  };
}

describe("deterministicQdrantPointId", () => {
  it("creates stable RFC UUIDv5 point IDs without storing source text", () => {
    const first = deterministicQdrantPointId(
      "needed_item",
      CURRENT_ENTRY_ID,
      " ＭＵＧ ",
    );
    const second = deterministicQdrantPointId(
      "needed_item",
      CURRENT_ENTRY_ID,
      "mug",
    );

    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      deterministicQdrantPointId("handoff", CURRENT_ENTRY_ID),
    ).not.toBe(first);
    expect(first).not.toContain("mug");
  });
});

describe("HomeRelayQdrantAdapter.indexConfirmedEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts only confirmed summaries and needed-item names through Cloud Inference", async () => {
    const { client, upsert } = mockClient();
    upsert.mockResolvedValue({ status: "completed" });
    const adapter = createQdrantAdapter({ client, config: CONFIG });

    await expect(adapter.indexConfirmedEntry(CONFIRMED_ENTRY)).resolves.toEqual({
      pointCount: 3,
      status: "indexed",
    });

    expect(upsert).toHaveBeenCalledOnce();
    const [collection, request] = upsert.mock.calls[0];
    expect(collection).toBe("homerelay_entries");
    expect(request).toMatchObject({ timeout: 4, wait: true });
    expect(request.points).toHaveLength(3);
    expect(request.points[0]).toEqual({
      id: deterministicQdrantPointId("handoff", CURRENT_ENTRY_ID),
      payload: {
        created_at: CREATED_AT,
        display_text:
          "昼食は半分ほど召し上がりました / 水分を用意しました / 次に訪れた方は水分をご確認ください",
        entry_id: CURRENT_ENTRY_ID,
        household_id: HOUSEHOLD_ID,
        type: "handoff",
      },
      vector: {
        model: "synthetic/multilingual-model",
        text: "昼食は半分ほど召し上がりました\n水分を用意しました\n次に訪れた方は水分をご確認ください",
      },
    });
    expect(request.points.slice(1).map((value: { vector: { text: string } }) => value.vector.text)).toEqual([
      "トイレットペーパー",
      "麦茶",
    ]);

    const serialized = JSON.stringify(request.points);
    for (const forbidden of [
      "photo",
      "audio",
      "author",
      "display_name",
      "member_id",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns an explicit non-throwing fallback when configuration is absent", async () => {
    const { client, upsert } = mockClient();
    const adapter = createQdrantAdapter({ client, config: null });

    await expect(adapter.indexConfirmedEntry(CONFIRMED_ENTRY)).resolves.toEqual({
      pointCount: 0,
      reason: "not_configured",
      status: "unavailable",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid or duplicate confirmed content before contacting Qdrant", async () => {
    const { client, upsert } = mockClient();
    const adapter = createQdrantAdapter({ client, config: CONFIG });

    await expect(
      adapter.indexConfirmedEntry({
        ...CONFIRMED_ENTRY,
        neededItems: ["麦茶", " 麦茶 "],
      }),
    ).resolves.toEqual({
      pointCount: 0,
      reason: "invalid_input",
      status: "unavailable",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("turns an SDK timeout or outage into a non-blocking result", async () => {
    const { client, upsert } = mockClient();
    upsert.mockRejectedValue(new Error("synthetic outage"));
    const adapter = createQdrantAdapter({ client, config: CONFIG });

    await expect(adapter.indexConfirmedEntry(CONFIRMED_ENTRY)).resolves.toEqual({
      pointCount: 0,
      reason: "unavailable",
      status: "unavailable",
    });
  });
});

describe("HomeRelayQdrantAdapter.findRelated", () => {
  const QUERY = {
    currentEntryId: CURRENT_ENTRY_ID,
    householdId: HOUSEHOLD_ID,
    queryText: "水分補給をお願いした申し送り",
    type: "handoff" as const,
  };

  it("always applies the session household, type, and current-entry exclusion", async () => {
    const { client, query } = mockClient();
    query.mockResolvedValue({ points: [] });
    const adapter = createQdrantAdapter({ client, config: CONFIG });

    await expect(adapter.findRelated(QUERY)).resolves.toEqual({
      items: [],
      status: "available",
    });
    expect(query).toHaveBeenCalledWith("homerelay_entries", {
      filter: {
        must: [
          { key: "household_id", match: { value: HOUSEHOLD_ID } },
          { key: "type", match: { value: "handoff" } },
        ],
        must_not: [
          { key: "entry_id", match: { value: CURRENT_ENTRY_ID } },
        ],
      },
      limit: 3,
      query: {
        model: "synthetic/multilingual-model",
        text: "水分補給をお願いした申し送り",
      },
      timeout: 4,
      with_payload: [
        "household_id",
        "entry_id",
        "type",
        "created_at",
        "display_text",
      ],
      with_vector: false,
    });
  });

  it("validates payloads, rejects cross-household/current/wrong-type points, and caps at three", async () => {
    const { client, query } = mockClient();
    query.mockResolvedValue({
      points: [
        point(RELATED_ENTRY_IDS[0], { householdId: FOREIGN_HOUSEHOLD_ID }),
        point(CURRENT_ENTRY_ID),
        point(RELATED_ENTRY_IDS[0], { type: "needed_item" }),
        { ...point(RELATED_ENTRY_IDS[0]), payload: { unexpected: true } },
        point(RELATED_ENTRY_IDS[0]),
        point(RELATED_ENTRY_IDS[1]),
        point(RELATED_ENTRY_IDS[2]),
        point(RELATED_ENTRY_IDS[3]),
      ],
    });
    const adapter = createQdrantAdapter({ client, config: CONFIG });

    const result = await adapter.findRelated(QUERY);

    expect(result).toMatchObject({ status: "available" });
    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.entryId)).toEqual(
      RELATED_ENTRY_IDS.slice(0, 3),
    );
    expect(result.items.every((item) => !("householdId" in item))).toBe(true);
  });

  it("returns invalid_response for a malformed SDK envelope", async () => {
    const { client, query } = mockClient();
    query.mockResolvedValue({ result: [] });
    const adapter = createQdrantAdapter({ client, config: CONFIG });

    await expect(adapter.findRelated(QUERY)).resolves.toEqual({
      items: [],
      reason: "invalid_response",
      status: "unavailable",
    });
  });

  it("returns unavailable without leaking vendor errors", async () => {
    const { client, query } = mockClient();
    query.mockRejectedValue(new Error("response mentioned a private endpoint"));
    const adapter = createQdrantAdapter({ client, config: CONFIG });

    await expect(adapter.findRelated(QUERY)).resolves.toEqual({
      items: [],
      reason: "unavailable",
      status: "unavailable",
    });
  });

  it("rejects invalid query inputs before contacting Qdrant", async () => {
    const { client, query } = mockClient();
    const adapter = createQdrantAdapter({ client, config: CONFIG });

    await expect(
      adapter.findRelated({ ...QUERY, householdId: "request-controlled" }),
    ).resolves.toEqual({
      items: [],
      reason: "invalid_input",
      status: "unavailable",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("does not contact Qdrant when credentials are unavailable", async () => {
    const { client, query } = mockClient();
    const adapter = createQdrantAdapter({ client, config: null });

    await expect(adapter.findRelated(QUERY)).resolves.toEqual({
      items: [],
      reason: "not_configured",
      status: "unavailable",
    });
    expect(query).not.toHaveBeenCalled();
  });
});
