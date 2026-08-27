import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  createNeo4jAdapter: vi.fn(),
  getNeo4jConfig: vi.fn(),
  syncConfirmedHandoff: vi.fn(),
  syncHandoffAction: vi.fn(),
  syncPurchaseAction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/neo4j/adapter", () => ({
  createNeo4jAdapter: mocks.createNeo4jAdapter,
}));
vi.mock("@/lib/neo4j/env", () => ({
  getNeo4jConfig: mocks.getNeo4jConfig,
}));

import {
  scheduleConfirmedHandoffGraphSync,
  scheduleHandoffActionGraphSync,
  schedulePurchaseActionGraphSync,
} from "@/lib/neo4j/sync";

const INPUT = {
  authorMemberId: "30000000-0000-4000-8000-000000000001",
  authorRole: "helper" as const,
  createdAt: "2026-08-28T02:03:04.000Z",
  entryId: "20000000-0000-4000-8000-000000000001",
  householdId: "10000000-0000-4000-8000-000000000001",
  neededItems: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      name: "合成ティッシュ",
    },
  ],
};

describe("scheduleConfirmedHandoffGraphSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createNeo4jAdapter.mockReturnValue({
      syncConfirmedHandoff: mocks.syncConfirmedHandoff,
      syncHandoffAction: mocks.syncHandoffAction,
      syncPurchaseAction: mocks.syncPurchaseAction,
    });
    mocks.after.mockImplementation((callback: () => Promise<void>) => callback);
  });

  it("does not schedule or create a client without live config", () => {
    mocks.getNeo4jConfig.mockReturnValue(null);

    expect(scheduleConfirmedHandoffGraphSync(INPUT)).toBe(false);
    expect(mocks.createNeo4jAdapter).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("registers best-effort graph sync after the confirmed response", async () => {
    const config = { database: "neo4j" };
    mocks.getNeo4jConfig.mockReturnValue(config);
    mocks.syncConfirmedHandoff.mockResolvedValue({
      relationshipCount: 5,
      status: "synced",
    });

    expect(scheduleConfirmedHandoffGraphSync(INPUT)).toBe(true);
    expect(mocks.createNeo4jAdapter).toHaveBeenCalledWith({ config });
    const callback = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await expect(callback()).resolves.toBeUndefined();
    expect(mocks.syncConfirmedHandoff).toHaveBeenCalledWith(INPUT);
  });

  it("keeps an unavailable graph result non-throwing", async () => {
    mocks.getNeo4jConfig.mockReturnValue({ database: "neo4j" });
    mocks.syncConfirmedHandoff.mockResolvedValue({
      reason: "unavailable",
      relationshipCount: 0,
      status: "unavailable",
    });

    expect(scheduleConfirmedHandoffGraphSync(INPUT)).toBe(true);
    const callback = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await expect(callback()).resolves.toBeUndefined();
  });

  it("schedules attributable handoff and purchase actions", async () => {
    mocks.getNeo4jConfig.mockReturnValue({ database: "neo4j" });
    mocks.syncHandoffAction.mockResolvedValue({
      relationshipCount: 4,
      status: "synced",
    });
    mocks.syncPurchaseAction.mockResolvedValue({
      relationshipCount: 5,
      status: "synced",
    });
    const action = {
      action: "claimed" as const,
      entryId: INPUT.entryId,
      householdId: INPUT.householdId,
      memberId: INPUT.authorMemberId,
      memberRole: "helper" as const,
      occurredAt: INPUT.createdAt,
    };
    const purchase = {
      ...action,
      action: "purchased" as const,
      itemId: "40000000-0000-4000-8000-000000000001",
    };

    expect(scheduleHandoffActionGraphSync(action)).toBe(true);
    const handoffCallback = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await handoffCallback();
    expect(mocks.syncHandoffAction).toHaveBeenCalledWith(action);

    expect(schedulePurchaseActionGraphSync(purchase)).toBe(true);
    const purchaseCallback = mocks.after.mock.calls[1][0] as () => Promise<void>;
    await purchaseCallback();
    expect(mocks.syncPurchaseAction).toHaveBeenCalledWith(purchase);
  });
});
