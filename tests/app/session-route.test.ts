import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentSession: vi.fn() }));

vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

import { GET } from "@/app/api/session/route";
import { fingerprintSessionId } from "@/lib/supabase/session-guard";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the verified user and session fingerprint for a current invited membership", async () => {
    mocks.getCurrentSession.mockResolvedValue({
      member: { id: "synthetic-member" },
      sessionId: SESSION_ID,
      userId: "synthetic-user",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionFingerprint: await fingerprintSessionId(SESSION_ID),
      userId: "synthetic-user",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects a missing or membership-deleted session", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("private");
  });
});
