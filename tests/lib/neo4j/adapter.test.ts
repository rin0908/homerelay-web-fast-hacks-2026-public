import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CONFIRMED_HANDOFF_CYPHER,
  createNeo4jAdapter,
  HANDOFF_ACTION_CYPHER,
  PURCHASE_ACTION_CYPHER,
} from "@/lib/neo4j/adapter";
import type { Neo4jClientLike } from "@/lib/neo4j/client";
import type { Neo4jConfig } from "@/lib/neo4j/env";

const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";
const ENTRY_ID = "20000000-0000-4000-8000-000000000001";
const AUTHOR_ID = "30000000-0000-4000-8000-000000000001";
const MEMBER_ID = "30000000-0000-4000-8000-000000000002";
const ITEM_ID = "40000000-0000-4000-8000-000000000001";
const SECOND_ITEM_ID = "40000000-0000-4000-8000-000000000002";
const OCCURRED_AT = "2026-08-28T02:03:04.000Z";

const CONFIG: Neo4jConfig = {
  database: "neo4j",
  password: "synthetic-password",
  queryApiUrl:
    "https://synthetic.databases.neo4j.io/db/neo4j/query/v2",
  timeoutMs: 4_000,
  username: "neo4j",
};

function mockClient() {
  const execute = vi.fn();
  return {
    client: { execute } as Neo4jClientLike,
    execute,
  };
}

describe("HomeRelayNeo4jAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs a privacy-minimized, household-scoped relation graph", async () => {
    const { client, execute } = mockClient();
    execute.mockResolvedValue({
      fields: ["entryId", "itemCount"],
      values: [[ENTRY_ID, 2]],
    });
    const adapter = createNeo4jAdapter({ client, config: CONFIG });

    await expect(
      adapter.syncConfirmedHandoff({
        authorMemberId: AUTHOR_ID,
        authorRole: "helper",
        createdAt: OCCURRED_AT,
        entryId: ENTRY_ID,
        householdId: HOUSEHOLD_ID,
        neededItems: [
          { id: ITEM_ID, name: "合成ティッシュ" },
          { id: SECOND_ITEM_ID, name: "合成せっけん" },
        ],
      }),
    ).resolves.toEqual({ relationshipCount: 7, status: "synced" });

    const [statement, parameters] = execute.mock.calls[0]!;
    expect(statement).toBe(CONFIRMED_HANDOFF_CYPHER);
    expect(statement).not.toMatch(/[\r\n]/);
    expect(statement).toContain("householdId: $householdId");
    expect(statement).toContain("[:MEMBER_OF]");
    expect(statement).toContain("[:AUTHORED]");
    expect(statement).toContain("[:INSTANCE_OF]");
    expect(parameters).toMatchObject({
      authorMemberId: AUTHOR_ID,
      authorRole: "helper",
      entryId: ENTRY_ID,
      householdId: HOUSEHOLD_ID,
    });
    expect(parameters.items).toEqual([
      {
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        id: ITEM_ID,
      },
      {
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        id: SECOND_ITEM_ID,
      },
    ]);
    const serialized = JSON.stringify(parameters);
    for (const forbidden of [
      "合成ティッシュ",
      "合成せっけん",
      "photo",
      "audio",
      "displayName",
      "summary",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("records attributable handoff and purchase actions with monotonic ranks", async () => {
    const { client, execute } = mockClient();
    execute
      .mockResolvedValueOnce({
        fields: ["entryId", "action"],
        values: [[ENTRY_ID, "claimed"]],
      })
      .mockResolvedValueOnce({
        fields: ["itemId", "action"],
        values: [[ITEM_ID, "purchased"]],
      });
    const adapter = createNeo4jAdapter({ client, config: CONFIG });

    await expect(
      adapter.syncHandoffAction({
        action: "claimed",
        entryId: ENTRY_ID,
        householdId: HOUSEHOLD_ID,
        memberId: MEMBER_ID,
        memberRole: "family",
        occurredAt: OCCURRED_AT,
      }),
    ).resolves.toEqual({ relationshipCount: 4, status: "synced" });
    await expect(
      adapter.syncPurchaseAction({
        action: "purchased",
        entryId: ENTRY_ID,
        householdId: HOUSEHOLD_ID,
        itemId: ITEM_ID,
        memberId: MEMBER_ID,
        memberRole: "family",
        occurredAt: OCCURRED_AT,
      }),
    ).resolves.toEqual({ relationshipCount: 5, status: "synced" });

    expect(execute.mock.calls[0][0]).toBe(HANDOFF_ACTION_CYPHER);
    expect(execute.mock.calls[0][1]).toMatchObject({
      action: "claimed",
      status: "claimed",
      statusRank: 2,
    });
    expect(execute.mock.calls[0][1].eventKey).toMatch(/^[0-9a-f]{64}$/);
    expect(execute.mock.calls[1][0]).toBe(PURCHASE_ACTION_CYPHER);
    expect(execute.mock.calls[1][1]).toMatchObject({
      action: "purchased",
      state: "purchased",
      stateRank: 3,
    });
    expect(execute.mock.calls[1][1].eventKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the same Supabase needed-item UUID for share and purchase projections", async () => {
    const { client, execute } = mockClient();
    execute
      .mockResolvedValueOnce({
        fields: ["entryId", "itemCount"],
        values: [[ENTRY_ID, 1]],
      })
      .mockResolvedValueOnce({
        fields: ["itemId", "action"],
        values: [[ITEM_ID, "purchase_intent"]],
      });
    const adapter = createNeo4jAdapter({ client, config: CONFIG });

    await adapter.syncConfirmedHandoff({
      authorMemberId: AUTHOR_ID,
      authorRole: "helper",
      createdAt: OCCURRED_AT,
      entryId: ENTRY_ID,
      householdId: HOUSEHOLD_ID,
      neededItems: [{ id: ITEM_ID, name: "合成ティッシュ" }],
    });
    await adapter.syncPurchaseAction({
      action: "purchase_intent",
      entryId: ENTRY_ID,
      householdId: HOUSEHOLD_ID,
      itemId: ITEM_ID,
      memberId: MEMBER_ID,
      memberRole: "family",
      occurredAt: OCCURRED_AT,
    });

    expect(execute.mock.calls[0][1].items[0].id).toBe(ITEM_ID);
    expect(execute.mock.calls[1][1].itemId).toBe(ITEM_ID);
  });

  it("does not contact Neo4j without explicit live configuration", async () => {
    const { client, execute } = mockClient();
    const adapter = createNeo4jAdapter({ client, config: null });

    await expect(
      adapter.syncConfirmedHandoff({
        authorMemberId: AUTHOR_ID,
        authorRole: "helper",
        createdAt: OCCURRED_AT,
        entryId: ENTRY_ID,
        householdId: HOUSEHOLD_ID,
        neededItems: [],
      }),
    ).resolves.toEqual({
      reason: "not_configured",
      relationshipCount: 0,
      status: "unavailable",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects invalid and duplicate inputs before any request", async () => {
    const { client, execute } = mockClient();
    const adapter = createNeo4jAdapter({ client, config: CONFIG });

    await expect(
      adapter.syncConfirmedHandoff({
        authorMemberId: AUTHOR_ID,
        authorRole: "helper",
        createdAt: OCCURRED_AT,
        entryId: ENTRY_ID,
        householdId: HOUSEHOLD_ID,
        neededItems: [
          { id: ITEM_ID, name: "合成ティッシュ" },
          { id: SECOND_ITEM_ID, name: " 合成ティッシュ " },
        ],
      }),
    ).resolves.toMatchObject({
      reason: "invalid_input",
      status: "unavailable",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("turns vendor errors and malformed envelopes into non-blocking results", async () => {
    const { client, execute } = mockClient();
    const adapter = createNeo4jAdapter({ client, config: CONFIG });
    const input = {
      authorMemberId: AUTHOR_ID,
      authorRole: "helper" as const,
      createdAt: OCCURRED_AT,
      entryId: ENTRY_ID,
      householdId: HOUSEHOLD_ID,
      neededItems: [] as const,
    };

    execute.mockRejectedValueOnce(new Error("private endpoint detail"));
    await expect(adapter.syncConfirmedHandoff(input)).resolves.toMatchObject({
      reason: "unavailable",
      status: "unavailable",
    });

    execute.mockResolvedValueOnce({ fields: ["entryId"], values: [] });
    await expect(adapter.syncConfirmedHandoff(input)).resolves.toMatchObject({
      reason: "invalid_response",
      status: "unavailable",
    });
  });
});
