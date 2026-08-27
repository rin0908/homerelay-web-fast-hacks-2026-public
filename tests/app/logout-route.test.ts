import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { POST } from "@/app/logout/route";

function request() {
  return new Request("https://homerelay.test/logout", { method: "POST" });
}

describe("POST /logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: { signOut: mocks.signOut },
    } as unknown as SupabaseClient);
  });

  it("returns to the existing demo when Supabase is unavailable", async () => {
    mocks.createClient.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://homerelay.test/");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("signs out only the current browser session", async () => {
    const response = await POST(request());

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/login?loggedOut=1",
    );
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not claim success when the provider rejects sign-out", async () => {
    mocks.signOut.mockResolvedValue({
      error: new Error("synthetic provider failure"),
    });

    const response = await POST(request());

    expect(response.headers.get("location")).toBe(
      "https://homerelay.test/?logout=failed",
    );
  });
});
