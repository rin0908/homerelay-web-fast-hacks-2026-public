import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSession: vi.fn(),
}));

vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: mocks.updateSession,
}));

import { config, proxy } from "@/proxy";

describe("Next.js root Proxy", () => {
  it("delegates to the Supabase session updater", async () => {
    const request = { synthetic: true } as unknown as NextRequest;
    const response = new Response(null, { status: 204 });
    mocks.updateSession.mockResolvedValue(response);

    await expect(proxy(request)).resolves.toBe(response);
    expect(mocks.updateSession).toHaveBeenCalledWith(request);
  });

  it("uses a static matcher that skips framework assets and images", () => {
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ]);
  });
});
