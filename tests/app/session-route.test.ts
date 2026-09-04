import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveCurrentSession: vi.fn() }));

vi.mock("@/lib/supabase/session", () => ({
  resolveCurrentSession: mocks.resolveCurrentSession,
}));

import { GET } from "@/app/api/session/route";
import { fingerprintSessionId } from "@/lib/supabase/session-guard";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the verified user and session fingerprint for a current invited membership", async () => {
    mocks.resolveCurrentSession.mockResolvedValue({
      session: {
        member: { id: "synthetic-member" },
        sessionId: SESSION_ID,
        userId: "synthetic-user",
      },
      state: "verified",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionFingerprint: await fingerprintSessionId(SESSION_ID),
      userId: "synthetic-user",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["indeterminate", 503],
  ])("maps %s to %i without caching", async (state, status) => {
    mocks.resolveCurrentSession.mockResolvedValue({ state });

    const response = await GET();

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("maps an unexpected resolver exception to an uncached 503", async () => {
    mocks.resolveCurrentSession.mockRejectedValue(
      new Error("synthetic resolver failure"),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["short", "invalid session id", "x".repeat(257)])(
    "rejects an invalid verified session id: %s",
    async (sessionId) => {
      mocks.resolveCurrentSession.mockResolvedValue({
        session: {
          member: { id: "synthetic-member" },
          sessionId,
          userId: "synthetic-user",
        },
        state: "verified",
      });

      const response = await GET();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );
});
