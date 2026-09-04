import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentSession: vi.fn(),
  getIntegrationStatus: vi.fn(),
  scheduleHandoffActionGraphSync: vi.fn(),
  schedulePurchaseActionGraphSync: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integration-status", () => ({
  getIntegrationStatus: mocks.getIntegrationStatus,
}));
vi.mock("@/lib/neo4j/sync", () => ({
  scheduleHandoffActionGraphSync: mocks.scheduleHandoffActionGraphSync,
  schedulePurchaseActionGraphSync: mocks.schedulePurchaseActionGraphSync,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

import { POST } from "@/app/api/actions/route";

const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";
const MEMBER_ID = "20000000-0000-4000-8000-000000000001";
const ENTRY_ID = "30000000-0000-4000-8000-000000000001";
const ITEM_ID = "40000000-0000-4000-8000-000000000001";
const MAX_ACTION_BODY_BYTES = 4_096;

function request(action: string, targetId: string = ENTRY_ID) {
  return new Request("http://localhost/api/actions", {
    body: JSON.stringify({ action, targetId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function streamingRequest(chunks: readonly Uint8Array[]) {
  let cancelled = false;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue(chunk);
      }
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    body,
    duplex: "half",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  };

  return {
    cancelled: () => cancelled,
    request: new Request("http://localhost/api/actions", init),
  };
}

function createSupabaseMock(itemOverrides: Record<string, unknown> = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      entry_id: ENTRY_ID,
      household_id: HOUSEHOLD_ID,
      id: ITEM_ID,
      status: "purchase_intent",
      ...itemOverrides,
    },
    error: null,
  });
  const query = {
    eq: vi.fn(),
    maybeSingle,
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const from = vi.fn().mockReturnValue(query);

  return { from, maybeSingle, query, rpc, supabase: { from, rpc } };
}

describe("POST /api/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIntegrationStatus.mockReturnValue({
      dataMode: "supabase",
      neo4j: { active: true },
    });
    mocks.getCurrentSession.mockResolvedValue({
      member: {
        authUserId: "50000000-0000-4000-8000-000000000001",
        displayName: "合成家族",
        householdId: HOUSEHOLD_ID,
        id: MEMBER_ID,
        role: "family",
      },
      userId: "50000000-0000-4000-8000-000000000001",
    });
  });

  it("never mutates data outside explicit Supabase mode", async () => {
    mocks.getIntegrationStatus.mockReturnValue({ dataMode: "demo" });

    const response = await POST(request("claim_entry"));

    expect(response.status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown_action", ENTRY_ID],
    ["claim_entry", "request-controlled"],
  ])("rejects invalid action input", async (action, targetId) => {
    const response = await POST(request(action, targetId));

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it.each([
    { actions: [] },
    {
      actions: Array.from({ length: 11 }, () => ({
        action: "claim_entry",
        targetId: ENTRY_ID,
      })),
    },
    {
      actions: [
        { action: "claim_entry", targetId: ENTRY_ID },
        { action: "unknown_action", targetId: ENTRY_ID },
      ],
    },
  ])("rejects an invalid action batch without authenticating", async (body) => {
    const response = await POST(
      new Request("http://localhost/api/actions", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("accepts valid JSON exactly at the actual-byte boundary", async () => {
    const { supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    const payload = JSON.stringify({
      action: "claim_entry",
      targetId: ENTRY_ID,
    });
    const padding = " ".repeat(
      MAX_ACTION_BODY_BYTES - new TextEncoder().encode(payload).byteLength,
    );
    const boundaryRequest = new Request("http://localhost/api/actions", {
      body: `${payload}${padding}`,
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(boundaryRequest.headers.get("content-length")).toBeNull();
    const response = await POST(boundaryRequest);

    expect(response.status).toBe(204);
    expect(supabase.rpc).toHaveBeenCalledWith("claim_entry", {
      p_entry_id: ENTRY_ID,
    });
  });

  it("cancels a chunked request once actual bytes exceed the limit", async () => {
    const source = streamingRequest([
      new Uint8Array(MAX_ACTION_BODY_BYTES),
      Uint8Array.from([1]),
    ]);

    expect(source.request.headers.get("content-length")).toBeNull();
    const response = await POST(source.request);

    expect(response.status).toBe(413);
    expect(source.cancelled()).toBe(true);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed Content-Length before parsing JSON", async () => {
    const malformed = new Request("http://localhost/api/actions", {
      body: JSON.stringify({ action: "claim_entry", targetId: ENTRY_ID }),
      headers: {
        "Content-Length": "not-a-number",
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const response = await POST(malformed);

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated household member", async () => {
    const { supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.getCurrentSession.mockResolvedValue(null);

    const response = await POST(request("claim_entry"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      completedCount: 0,
      error: "ログインが必要です",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["acknowledge_entry", "confirmed"],
    ["claim_entry", "claimed"],
    ["complete_entry", "done"],
  ] as const)(
    "runs %s through a guarded server RPC before graph sync",
    async (action, graphAction) => {
      const { supabase } = createSupabaseMock();
      mocks.createClient.mockResolvedValue(supabase);

      const response = await POST(request(action));

      expect(response.status).toBe(204);
      expect(supabase.rpc).toHaveBeenCalledWith(action, {
        p_entry_id: ENTRY_ID,
      });
      expect(mocks.scheduleHandoffActionGraphSync).toHaveBeenCalledWith({
        action: graphAction,
        entryId: ENTRY_ID,
        householdId: HOUSEHOLD_ID,
        memberId: MEMBER_ID,
        memberRole: "family",
        occurredAt: expect.any(String),
      });
      const serialized = JSON.stringify(
        mocks.scheduleHandoffActionGraphSync.mock.calls[0][0],
      );
      expect(serialized).not.toContain("合成家族");
    },
  );

  it("runs a rapid household action sequence in order after one authentication", async () => {
    const { supabase } = createSupabaseMock({ status: "purchased" });
    mocks.createClient.mockResolvedValue(supabase);
    const response = await POST(
      new Request("http://localhost/api/actions", {
        body: JSON.stringify({
          actions: [
            { action: "acknowledge_entry", targetId: ENTRY_ID },
            { action: "claim_entry", targetId: ENTRY_ID },
            { action: "complete_entry", targetId: ENTRY_ID },
            { action: "claim_needed_item", targetId: ITEM_ID },
            { action: "complete_needed_item", targetId: ITEM_ID },
          ],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.getCurrentSession).toHaveBeenCalledOnce();
    expect(supabase.rpc.mock.calls).toEqual([
      ["acknowledge_entry", { p_entry_id: ENTRY_ID }],
      ["claim_entry", { p_entry_id: ENTRY_ID }],
      ["complete_entry", { p_entry_id: ENTRY_ID }],
      ["claim_needed_item", { p_item_id: ITEM_ID }],
      ["complete_needed_item", { p_item_id: ITEM_ID }],
    ]);
    expect(mocks.schedulePurchaseActionGraphSync).toHaveBeenCalledWith(
      expect.objectContaining({ action: "purchased", itemId: ITEM_ID }),
    );
    expect(mocks.schedulePurchaseActionGraphSync.mock.calls).toEqual([
      [expect.objectContaining({ action: "purchase_intent", itemId: ITEM_ID })],
      [expect.objectContaining({ action: "purchased", itemId: ITEM_ID })],
    ]);
  });

  it("stops a batch after the first guarded RPC failure", async () => {
    const { rpc, supabase } = createSupabaseMock();
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "P0001" } });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(
      new Request("http://localhost/api/actions", {
        body: JSON.stringify({
          actions: [
            { action: "acknowledge_entry", targetId: ENTRY_ID },
            { action: "claim_entry", targetId: ENTRY_ID },
            { action: "complete_entry", targetId: ENTRY_ID },
          ],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      completedCount: 1,
      error: "操作を完了できませんでした",
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).not.toHaveBeenCalledWith("complete_entry", expect.anything());
  });

  it("projects successful purchase actions before returning a partial failure", async () => {
    const { rpc, supabase } = createSupabaseMock({ status: "purchase_intent" });
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "P0001" } });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(
      new Request("http://localhost/api/actions", {
        body: JSON.stringify({
          actions: [
            { action: "claim_needed_item", targetId: ITEM_ID },
            { action: "complete_needed_item", targetId: ITEM_ID },
          ],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ completedCount: 1 });
    expect(mocks.schedulePurchaseActionGraphSync).toHaveBeenCalledOnce();
    expect(mocks.schedulePurchaseActionGraphSync).toHaveBeenCalledWith(
      expect.objectContaining({ action: "purchase_intent", itemId: ITEM_ID }),
    );
  });

  it.each([
    ["claim_needed_item", "purchase_intent"],
    ["complete_needed_item", "purchased"],
  ] as const)(
    "revalidates %s through household RLS before graph sync",
    async (action, status) => {
      const { query, supabase } = createSupabaseMock({ status });
      mocks.createClient.mockResolvedValue(supabase);

      const response = await POST(request(action, ITEM_ID));

      expect(response.status).toBe(204);
      expect(supabase.rpc).toHaveBeenCalledWith(action, { p_item_id: ITEM_ID });
      expect(supabase.from).toHaveBeenCalledWith("needed_items");
      expect(query.select).toHaveBeenCalledWith(
        "id, entry_id, household_id, status",
      );
      expect(query.eq).toHaveBeenCalledWith("id", ITEM_ID);
      expect(mocks.schedulePurchaseActionGraphSync).toHaveBeenCalledWith({
        action: status,
        entryId: ENTRY_ID,
        householdId: HOUSEHOLD_ID,
        itemId: ITEM_ID,
        memberId: MEMBER_ID,
        memberRole: "family",
        occurredAt: expect.any(String),
      });
    },
  );

  it("keeps a completed Supabase action successful when graph revalidation fails", async () => {
    const { supabase } = createSupabaseMock({
      household_id: "10000000-0000-4000-8000-000000000002",
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(request("claim_needed_item", ITEM_ID));

    expect(response.status).toBe(204);
    expect(mocks.schedulePurchaseActionGraphSync).not.toHaveBeenCalled();
  });

  it("does no graph-only read or scheduling when Neo4j is inactive", async () => {
    const { supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.getIntegrationStatus.mockReturnValue({
      dataMode: "supabase",
      neo4j: { active: false },
    });

    const response = await POST(request("claim_needed_item", ITEM_ID));

    expect(response.status).toBe(204);
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mocks.scheduleHandoffActionGraphSync).not.toHaveBeenCalled();
    expect(mocks.schedulePurchaseActionGraphSync).not.toHaveBeenCalled();
  });

  it("keeps the successful RPC response when graph revalidation throws", async () => {
    const { maybeSingle, supabase } = createSupabaseMock();
    maybeSingle.mockRejectedValueOnce(new Error("synthetic read failure"));
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(request("claim_needed_item", ITEM_ID));

    expect(response.status).toBe(204);
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(mocks.schedulePurchaseActionGraphSync).not.toHaveBeenCalled();
  });

  it("keeps the successful RPC response when graph scheduling throws", async () => {
    const { supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.scheduleHandoffActionGraphSync.mockImplementationOnce(() => {
      throw new Error("synthetic scheduler failure");
    });

    const response = await POST(request("claim_entry"));

    expect(response.status).toBe(204);
    expect(supabase.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["42501", 403],
    ["P0001", 409],
    ["22023", 400],
    ["PGRST000", 502],
  ])("maps guarded RPC code %s without scheduling graph work", async (code, status) => {
    const { supabase } = createSupabaseMock();
    supabase.rpc.mockResolvedValue({ data: null, error: { code } });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(request("claim_entry"));

    expect(response.status).toBe(status);
    expect(mocks.scheduleHandoffActionGraphSync).not.toHaveBeenCalled();
    expect(mocks.schedulePurchaseActionGraphSync).not.toHaveBeenCalled();
  });
});
