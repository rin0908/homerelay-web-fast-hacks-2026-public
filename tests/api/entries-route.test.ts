import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentSession: vi.fn(),
  getIntegrationStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integration-status", () => ({
  getIntegrationStatus: mocks.getIntegrationStatus,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

import { POST } from "@/app/api/entries/route";

const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";
const MEMBER_ID = "20000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "30000000-0000-4000-8000-000000000001";

function validRequest() {
  const formData = new FormData();
  formData.set("idempotencyKey", IDEMPOTENCY_KEY);
  formData.set("conditionSummary", "合成デモの様子");
  formData.set("completedSummary", "合成デモを完了");
  formData.set("nextRequest", "次の方へお願いします");
  formData.set("photoAlt", "合成デモで撮影した申し送り写真");
  formData.set("neededItems", JSON.stringify(["合成ティッシュ"]));
  formData.set(
    "photo",
    new File(
      [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0xff])],
      "synthetic.jpg",
      { type: "image/jpeg" },
    ),
  );
  return {
    headers: new Headers(),
    formData: vi.fn(async () => formData),
  } as unknown as Request;
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
      data: "40000000-0000-4000-8000-000000000001",
      error: null,
    }),
  );
  const supabase = {
    rpc,
    storage: { from: vi.fn(() => bucket) },
  };
  return { bucket, supabase };
}

describe("POST /api/entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIntegrationStatus.mockReturnValue({ dataMode: "supabase" });
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
  });
});
