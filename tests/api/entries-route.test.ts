import { File as NodeFile } from "node:buffer";

import { FormData as UndiciFormData } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("File", NodeFile);
vi.stubGlobal("FormData", UndiciFormData);

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentSession: vi.fn(),
  getIntegrationStatus: vi.fn(),
  scheduleConfirmedHandoffGraphSync: vi.fn(),
  scheduleConfirmedEntryIndex: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integration-status", () => ({
  getIntegrationStatus: mocks.getIntegrationStatus,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/lib/qdrant/indexing", () => ({
  scheduleConfirmedEntryIndex: mocks.scheduleConfirmedEntryIndex,
}));
vi.mock("@/lib/neo4j/sync", () => ({
  scheduleConfirmedHandoffGraphSync:
    mocks.scheduleConfirmedHandoffGraphSync,
}));

import { POST } from "@/app/api/entries/route";

const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";
const MEMBER_ID = "20000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "30000000-0000-4000-8000-000000000001";
const CREATED_ENTRY_ID = "40000000-0000-4000-8000-000000000001";
const CREATED_ITEM_ID = "60000000-0000-4000-8000-000000000001";
const MAX_PUBLISH_BODY_BYTES = 4 * 1024 * 1024;

function validRequest() {
  const boundary = "homerelay-synthetic-entry-boundary";
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const fields = {
    completedSummary: "合成デモを完了",
    conditionSummary: "合成デモの様子",
    idempotencyKey: IDEMPOTENCY_KEY,
    neededItems: JSON.stringify(["合成ティッシュ"]),
    nextRequest: "次の方へお願いします",
    photoAlt: "合成デモで撮影した申し送り写真",
  };
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="synthetic.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0xff,
    ]),
    encoder.encode(`\r\n--${boundary}--\r\n`),
  );
  const body = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Request("http://localhost/api/entries", {
    body,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
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
    headers: { "Content-Type": "multipart/form-data; boundary=synthetic" },
    method: "POST",
  };

  return {
    cancelled: () => cancelled,
    request: new Request("http://localhost/api/entries", init),
  };
}

function createSupabaseMock() {
  const bucket = {
    download: vi.fn(async () => ({ data: new Blob(["existing"]), error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    upload: vi.fn(async () => ({ data: { path: "synthetic" }, error: null })),
  };
  const rpc = vi.fn(
    async (): Promise<{
      data: string | null;
      error: { code: string; message: string } | null;
    }> => ({
      data: CREATED_ENTRY_ID,
      error: null,
    }),
  );
  const itemQuery = {
    eq: vi.fn(),
    select: vi.fn(),
  };
  itemQuery.select.mockReturnValue(itemQuery);
  itemQuery.eq.mockResolvedValue({
    data: [
      {
        entry_id: CREATED_ENTRY_ID,
        household_id: HOUSEHOLD_ID,
        id: CREATED_ITEM_ID,
        name: "合成ティッシュ",
      },
    ],
    error: null,
  });
  const from = vi.fn(() => itemQuery);
  const supabase = {
    from,
    rpc,
    storage: { from: vi.fn(() => bucket) },
  };
  return { bucket, from, itemQuery, supabase };
}

describe("POST /api/entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIntegrationStatus.mockReturnValue({
      dataMode: "supabase",
      neo4j: { active: true },
    });
    mocks.getCurrentSession.mockResolvedValue({
      member: {
        authUserId: "50000000-0000-4000-8000-000000000001",
        displayName: "合成ヘルパー",
        householdId: HOUSEHOLD_ID,
        id: MEMBER_ID,
        role: "helper",
      },
      userId: "50000000-0000-4000-8000-000000000001",
    });
  });

  it("never writes to demo storage when Supabase mode is unavailable", async () => {
    mocks.getIntegrationStatus.mockReturnValue({ dataMode: "demo" });

    const response = await POST(validRequest());

    expect(response.status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("cancels a chunked request that exceeds the actual-byte limit", async () => {
    const source = streamingRequest([
      new Uint8Array(MAX_PUBLISH_BODY_BYTES),
      Uint8Array.from([1]),
    ]);

    expect(source.request.headers.get("content-length")).toBeNull();
    const response = await POST(source.request);

    expect(response.status).toBe(413);
    expect(source.cancelled()).toBe(true);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed Content-Length", async () => {
    const request = validRequest();
    request.headers.set("content-length", "invalid");

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "共有内容を読み取れませんでした",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated household member", async () => {
    const { supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.getCurrentSession.mockResolvedValue(null);

    const response = await POST(validRequest());

    expect(response.status).toBe(401);
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it("uploads to a session-derived path and calls the guarded RPC", async () => {
    const { bucket, supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(validRequest());
    const expectedPath = `${HOUSEHOLD_ID}/${MEMBER_ID}/${IDEMPOTENCY_KEY}.jpg`;

    expect(response.status).toBe(201);
    expect(bucket.upload).toHaveBeenCalledWith(
      expectedPath,
      expect.any(File),
      expect.objectContaining({ contentType: "image/jpeg", upsert: false }),
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "share_handoff",
      expect.objectContaining({
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_photo_alt: "合成デモで撮影した申し送り写真",
        p_photo_path: expectedPath,
        p_photo_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(mocks.scheduleConfirmedEntryIndex).toHaveBeenCalledWith({
      completedSummary: "合成デモを完了",
      conditionSummary: "合成デモの様子",
      createdAt: expect.any(String),
      entryId: CREATED_ENTRY_ID,
      householdId: HOUSEHOLD_ID,
      neededItems: ["合成ティッシュ"],
      nextRequest: "次の方へお願いします",
    });
    expect(mocks.scheduleConfirmedEntryIndex.mock.calls[0][0]).not.toHaveProperty(
      "photoAlt",
    );
    expect(mocks.scheduleConfirmedHandoffGraphSync).toHaveBeenCalledWith({
      authorMemberId: MEMBER_ID,
      authorRole: "helper",
      createdAt: expect.any(String),
      entryId: CREATED_ENTRY_ID,
      householdId: HOUSEHOLD_ID,
      neededItems: [{ id: CREATED_ITEM_ID, name: "合成ティッシュ" }],
    });
    expect(
      mocks.scheduleConfirmedHandoffGraphSync.mock.calls[0][0],
    ).not.toHaveProperty("photoAlt");
  });

  it("does no graph-only read when Neo4j is inactive", async () => {
    const { from, supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.getIntegrationStatus.mockReturnValue({
      dataMode: "supabase",
      neo4j: { active: false },
    });

    const response = await POST(validRequest());

    expect(response.status).toBe(201);
    expect(from).not.toHaveBeenCalled();
    expect(mocks.scheduleConfirmedHandoffGraphSync).not.toHaveBeenCalled();
    expect(mocks.scheduleConfirmedEntryIndex).toHaveBeenCalledOnce();
  });

  it("keeps the confirmed share successful when graph revalidation throws", async () => {
    const { itemQuery, supabase } = createSupabaseMock();
    itemQuery.eq.mockRejectedValueOnce(
      new Error("synthetic optional read failure"),
    );
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(validRequest());

    expect(response.status).toBe(201);
    expect(mocks.scheduleConfirmedEntryIndex).toHaveBeenCalledWith(
      expect.objectContaining({ neededItems: ["合成ティッシュ"] }),
    );
    expect(mocks.scheduleConfirmedHandoffGraphSync).not.toHaveBeenCalled();
  });

  it("keeps the confirmed share successful when graph scheduling throws", async () => {
    const { supabase } = createSupabaseMock();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.scheduleConfirmedHandoffGraphSync.mockImplementationOnce(() => {
      throw new Error("synthetic scheduler failure");
    });

    const response = await POST(validRequest());

    expect(response.status).toBe(201);
    expect(mocks.scheduleConfirmedEntryIndex).toHaveBeenCalledOnce();
  });

  it("removes only the newly uploaded photo when the transaction RPC fails", async () => {
    const { bucket, supabase } = createSupabaseMock();
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "idempotency_conflict" },
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(validRequest());

    expect(response.status).toBe(409);
    expect(bucket.remove).toHaveBeenCalledWith([
      `${HOUSEHOLD_ID}/${MEMBER_ID}/${IDEMPOTENCY_KEY}.jpg`,
    ]);
    expect(mocks.scheduleConfirmedEntryIndex).not.toHaveBeenCalled();
    expect(mocks.scheduleConfirmedHandoffGraphSync).not.toHaveBeenCalled();
  });

  it("keeps a new photo when a transport error could hide a committed RPC", async () => {
    const { bucket, supabase } = createSupabaseMock();
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST000", message: "transport unavailable" },
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(validRequest());

    expect(response.status).toBe(502);
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(mocks.scheduleConfirmedEntryIndex).not.toHaveBeenCalled();
    expect(mocks.scheduleConfirmedHandoffGraphSync).not.toHaveBeenCalled();
  });
});
