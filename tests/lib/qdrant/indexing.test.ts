import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  createQdrantAdapter: vi.fn(),
  getQdrantConfig: vi.fn(),
  indexConfirmedEntry: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/qdrant/adapter", () => ({
  createQdrantAdapter: mocks.createQdrantAdapter,
}));
vi.mock("@/lib/qdrant/env", () => ({
  getQdrantConfig: mocks.getQdrantConfig,
}));

import { scheduleConfirmedEntryIndex } from "@/lib/qdrant/indexing";

const input = {
  completedSummary: "水分を用意しました",
  conditionSummary: "昼食は半分ほどでした",
  createdAt: "2026-08-28T01:00:00.000Z",
  entryId: "10000000-0000-4000-8000-000000000001",
  householdId: "20000000-0000-4000-8000-000000000001",
  neededItems: ["ティッシュ"],
  nextRequest: "次回もご確認ください",
} as const;

describe("scheduleConfirmedEntryIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createQdrantAdapter.mockReturnValue({
      indexConfirmedEntry: mocks.indexConfirmedEntry,
    });
    mocks.after.mockImplementation((callback: () => Promise<void>) => callback);
  });

  it("does not create a client or background task without live config", () => {
    mocks.getQdrantConfig.mockReturnValue(null);

    expect(scheduleConfirmedEntryIndex(input)).toBe(false);
    expect(mocks.createQdrantAdapter).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("registers best-effort indexing after a confirmed response", async () => {
    const config = { collection: "synthetic" };
    mocks.getQdrantConfig.mockReturnValue(config);
    mocks.indexConfirmedEntry.mockResolvedValue({
      pointCount: 2,
      status: "indexed",
    });

    expect(scheduleConfirmedEntryIndex(input)).toBe(true);
    expect(mocks.createQdrantAdapter).toHaveBeenCalledWith({ config });
    const callback = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await expect(callback()).resolves.toBeUndefined();
    expect(mocks.indexConfirmedEntry).toHaveBeenCalledWith(input);
  });

  it("keeps the task non-throwing when Qdrant reports unavailable", async () => {
    mocks.getQdrantConfig.mockReturnValue({ collection: "synthetic" });
    mocks.indexConfirmedEntry.mockResolvedValue({
      pointCount: 0,
      reason: "unavailable",
      status: "unavailable",
    });

    expect(scheduleConfirmedEntryIndex(input)).toBe(true);
    const callback = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await expect(callback()).resolves.toBeUndefined();
  });
});
