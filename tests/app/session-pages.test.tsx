import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fingerprintSessionId: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("synthetic_redirect");
  }),
  resolveCurrentSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/integration-status", () => ({
  getIntegrationStatus: () => ({ dataMode: "supabase" }),
}));
vi.mock("@/lib/supabase/session", () => ({
  resolveCurrentSession: mocks.resolveCurrentSession,
}));
vi.mock("@/lib/supabase/session-guard", () => ({
  fingerprintSessionId: mocks.fingerprintSessionId,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => null,
}));

import HomePage from "@/app/page";
import RecordPage from "@/app/record/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveCurrentSession.mockResolvedValue({ state: "indeterminate" });
  mocks.fingerprintSessionId.mockResolvedValue("a".repeat(64));
});

afterEach(cleanup);

describe("private session pages", () => {
  it.each([
    ["home", () => HomePage()],
    ["record", () => RecordPage({ searchParams: Promise.resolve({}) })],
  ])("renders no private DOM or redirect for an indeterminate %s session", async (_name, page) => {
    render(await page());

    expect(
      screen.getByRole("heading", {
        name: "ログインを確認できませんでした",
      }),
    ).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(screen.queryByText("今日の様子")).not.toBeInTheDocument();
    expect(screen.queryByText("写真と声で記録")).not.toBeInTheDocument();
  });

  it.each(["unauthenticated", "forbidden"])(
    "redirects the home page for a confirmed %s session",
    async (state) => {
      mocks.resolveCurrentSession.mockResolvedValue({ state });

      await expect(HomePage()).rejects.toThrow("synthetic_redirect");
      expect(mocks.redirect).toHaveBeenCalledWith("/login");
    },
  );

  it("renders no private identity in the DOM when fingerprinting fails", async () => {
    const privateIdentity = {
      displayName: "Synthetic Private Family",
      householdId: "synthetic-private-household",
      memberId: "synthetic-private-member",
      userId: "synthetic-private-user",
    };
    mocks.resolveCurrentSession.mockResolvedValue({
      session: {
        member: {
          displayName: privateIdentity.displayName,
          householdId: privateIdentity.householdId,
          id: privateIdentity.memberId,
          role: "family",
        },
        sessionId: "synthetic-session",
        userId: privateIdentity.userId,
      },
      state: "verified",
    });
    mocks.fingerprintSessionId.mockResolvedValue(null);

    render(await HomePage());

    expect(
      screen.getByRole("heading", {
        name: "ログインを確認できませんでした",
      }),
    ).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
    const renderedText = document.body.textContent ?? "";
    expect(renderedText).not.toContain(privateIdentity.displayName);
    expect(renderedText).not.toContain(privateIdentity.householdId);
    expect(renderedText).not.toContain(privateIdentity.memberId);
    expect(renderedText).not.toContain(privateIdentity.userId);
  });
});
