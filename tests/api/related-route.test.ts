import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createQdrantAdapter: vi.fn(),
  findRelated: vi.fn(),
  getCurrentSession: vi.fn(),
  getIntegrationStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integration-status", () => ({
  getIntegrationStatus: mocks.getIntegrationStatus,
}));
vi.mock("@/lib/qdrant/adapter", () => ({
  createQdrantAdapter: mocks.createQdrantAdapter,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

import { GET } from "@/app/api/entries/[entryId]/related/route";

const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";
const ENTRY_ID = "20000000-0000-4000-8000-000000000001";
const CANDIDATE_ID = "20000000-0000-4000-8000-000000000002";
const FOREIGN_ID = "20000000-0000-4000-8000-000000000003";

const currentEntry = {
  id: ENTRY_ID,
  household_id: HOUSEHOLD_ID,
  condition_summary: "昼食は半分ほどでした",
  completed_summary: "水分を用意しました",
  next_request: "水分をご確認ください",
  created_at: "2026-08-28T01:00:00.000Z",
  needed_items: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      name: "ティッシュ",
      status: "needed",
    },
  ],
};

const candidateEntry = {
  id: CANDIDATE_ID,
  household_id: HOUSEHOLD_ID,
  condition_summary: "以前も昼食は少なめでした",
  completed_summary: "飲み物を準備しました",
  next_request: "次回もご確認ください",
  created_at: "2026-08-27T01:00:00.000Z",
  needed_items: [
    {
      id: "30000000-0000-4000-8000-000000000002",
      name: "ティッシュ",
      status: "purchase_intent",
    },
  ],
};

function context(entryId = ENTRY_ID) {
  return { params: Promise.resolve({ entryId }) };
}

function createSupabaseMock(options?: {
  candidateRows?: unknown[];
  current?: unknown;
  currentError?: unknown;
}) {
  const currentMaybeSingle = vi.fn(async () => ({
    data:
      options && Object.prototype.hasOwnProperty.call(options, "current")
        ? options.current
        : currentEntry,
    error:
      options && Object.prototype.hasOwnProperty.call(options, "currentError")
        ? options.currentError
        : null,
  }));
  const candidateIn = vi.fn(async () => ({
    data: options?.candidateRows ?? [candidateEntry],
    error: null,
  }));
  let entriesReads = 0;
  const from = vi.fn(() => ({
    select: vi.fn(() => {
      entriesReads += 1;
      if (entriesReads === 1) {
        return {
          eq: vi.fn(() => ({ maybeSingle: currentMaybeSingle })),
        };
      }
      return { in: candidateIn };
    }),
  }));
  return { candidateIn, currentMaybeSingle, supabase: { from } };
}

describe("GET /api/entries/[entryId]/related", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIntegrationStatus.mockReturnValue({ dataMode: "supabase" });
    mocks.getCurrentSession.mockResolvedValue({
      member: { householdId: HOUSEHOLD_ID },
      userId: "40000000-0000-4000-8000-000000000001",
    });
    mocks.createQdrantAdapter.mockReturnValue({
      findRelated: mocks.findRelated,
    });
  });

  it("does not access Supabase or Qdrant from demo mode", async () => {
    mocks.getIntegrationStatus.mockReturnValue({ dataMode: "demo" });

    const response = await GET(new Request("http://local/"), context());

    expect(response.status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createQdrantAdapter).not.toHaveBeenCalled();
  });

  it("requires an authenticated member before checking Qdrant", async () => {
    const { supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.getCurrentSession.mockResolvedValue(null);

    const response = await GET(new Request("http://local/"), context());

    expect(response.status).toBe(401);
    expect(mocks.createQdrantAdapter).not.toHaveBeenCalled();
  });

  it("returns the same not-found response for an invisible entry", async () => {
    const { supabase } = createSupabaseMock({ current: null });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await GET(new Request("http://local/"), context());

    expect(response.status).toBe(404);
    expect(mocks.findRelated).not.toHaveBeenCalled();
  });

  it("returns an explicit empty unavailable result without fabricating candidates", async () => {
    const { supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.findRelated.mockResolvedValue({
      items: [],
      reason: "not_configured",
      status: "unavailable",
    });

    const response = await GET(new Request("http://local/"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mode: "unavailable",
      similarHandoffs: [],
      duplicateItems: [],
    });
    expect(mocks.findRelated).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: HOUSEHOLD_ID }),
    );
  });

  it("revalidates candidate IDs through Supabase RLS and excludes foreign payloads", async () => {
    const { candidateIn, supabase } = createSupabaseMock({
      candidateRows: [candidateEntry],
    });
    mocks.createClient.mockResolvedValue(supabase);
    mocks.findRelated
      .mockResolvedValueOnce({
        status: "available",
        items: [
          {
            createdAt: candidateEntry.created_at,
            displayText: candidateEntry.condition_summary,
            entryId: CANDIDATE_ID,
            pointId: "handoff-candidate",
            score: 0.91,
            type: "handoff",
          },
          {
            createdAt: candidateEntry.created_at,
            displayText: "別世帯候補",
            entryId: FOREIGN_ID,
            pointId: "foreign-candidate",
            score: 0.99,
            type: "handoff",
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "available",
        items: [
          {
            createdAt: candidateEntry.created_at,
            displayText: "ティッシュ",
            entryId: CANDIDATE_ID,
            pointId: "item-candidate",
            score: 0.95,
            type: "needed_item",
          },
        ],
      });

    const response = await GET(new Request("http://local/"), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(candidateIn).toHaveBeenCalledWith("id", [CANDIDATE_ID, FOREIGN_ID]);
    expect(payload.mode).toBe("qdrant");
    expect(payload.similarHandoffs).toHaveLength(1);
    expect(payload.similarHandoffs[0].entryId).toBe(CANDIDATE_ID);
    expect(payload.duplicateItems).toEqual([
      expect.objectContaining({
        candidateItemName: "ティッシュ",
        currentItemName: "ティッシュ",
        entryId: CANDIDATE_ID,
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain(FOREIGN_ID);
  });

  it("drops Qdrant item candidates that are already purchased in Supabase", async () => {
    const purchasedCandidate = {
      ...candidateEntry,
      needed_items: [
        { ...candidateEntry.needed_items[0], status: "purchased" },
      ],
    };
    const { supabase } = createSupabaseMock({
      candidateRows: [purchasedCandidate],
    });
    mocks.createClient.mockResolvedValue(supabase);
    mocks.findRelated
      .mockResolvedValueOnce({ status: "available", items: [] })
      .mockResolvedValueOnce({
        status: "available",
        items: [
          {
            createdAt: candidateEntry.created_at,
            displayText: "ティッシュ",
            entryId: CANDIDATE_ID,
            pointId: "item-candidate",
            score: 0.95,
            type: "needed_item",
          },
        ],
      });

    const response = await GET(new Request("http://local/"), context());

    expect(response.status).toBe(200);
    expect((await response.json()).duplicateItems).toEqual([]);
  });
});
