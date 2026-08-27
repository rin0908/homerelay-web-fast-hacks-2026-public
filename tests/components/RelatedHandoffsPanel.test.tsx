import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelatedHandoffsPanel } from "@/components/RelatedHandoffsPanel";
import { SYNTHETIC_ENTRIES } from "@/lib/synthetic-data";
import type { HandoffEntry } from "@/types/handoff";

const entry = SYNTHETIC_ENTRIES[0];

function relatedResponse(
  overrides: Partial<{
    mode: "qdrant" | "unavailable";
    similarHandoffs: Array<{
      entryId: string;
      summary: string;
      createdAt: string;
      score: number;
    }>;
    duplicateItems: Array<{
      entryId: string;
      currentItemName: string;
      candidateItemName: string;
      createdAt: string;
      score: number;
    }>;
  }> = {},
) {
  return {
    duplicateItems: [],
    mode: "qdrant" as const,
    similarHandoffs: [],
    ...overrides,
  };
}

function okResponse(body: unknown): Response {
  return {
    json: vi.fn().mockResolvedValue(body),
    ok: true,
  } as unknown as Response;
}

describe("RelatedHandoffsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a fixture-derived synthetic candidate without fetching in demo mode", () => {
    render(<RelatedHandoffsPanel entry={entry} mode="demo" />);

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("合成候補（Qdrant未接続）")).toBeInTheDocument();
    expect(screen.getAllByText("トイレットペーパー").length).toBeGreaterThan(0);
    expect(
      screen.getByText("これは動作確認用の表示です。Qdrantの検索結果ではありません。"),
    ).toBeInTheDocument();
  });

  it("fetches and renders Qdrant results for the selected live entry", async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse(
        relatedResponse({
          duplicateItems: [
            {
              candidateItemName: "トイレットペーパー 12ロール",
              createdAt: "2026-08-26T03:00:00.000Z",
              currentItemName: "トイレットペーパー",
              entryId: "older-item-entry",
              score: 0.91,
            },
          ],
          similarHandoffs: [
            {
              createdAt: "2026-08-25T03:00:00.000Z",
              entryId: "older-handoff-entry",
              score: 0.87,
              summary: "昼食後に水分を用意しました",
            },
          ],
        }),
      ),
    );

    render(<RelatedHandoffsPanel entry={entry} mode="supabase" />);

    expect(screen.getByRole("status")).toHaveTextContent("関連候補を探しています");
    await screen.findByText("Qdrant検索結果");

    expect(fetch).toHaveBeenCalledWith(
      `/api/entries/${encodeURIComponent(entry.id)}/related`,
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "類似する過去の申し送り" }),
    ).toBeInTheDocument();
    expect(screen.getByText("昼食後に水分を用意しました")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "必要品の重複候補" }),
    ).toBeInTheDocument();
    expect(screen.getByText("過去の候補: トイレットペーパー 12ロール")).toBeInTheDocument();
    expect(screen.getByText("一致度 87%")).toBeInTheDocument();
  });

  it("keeps the loading state visible while the live request is pending", () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));

    render(<RelatedHandoffsPanel entry={entry} mode="supabase" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("関連候補を探しています");
  });

  it("shows unavailable and empty Qdrant states clearly", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse(relatedResponse({ mode: "unavailable" })),
    );
    const { rerender } = render(
      <RelatedHandoffsPanel entry={entry} mode="supabase" />,
    );

    expect(
      await screen.findByText("Qdrantは未接続、または一時的に利用できません。"),
    ).toBeInTheDocument();

    const nextEntry: HandoffEntry = { ...entry, id: "next/entry id" };
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(relatedResponse()));
    rerender(<RelatedHandoffsPanel entry={nextEntry} mode="supabase" />);

    expect(
      await screen.findByText("Qdrantで検索しましたが、関連候補は見つかりませんでした。"),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/entries/next%2Fentry%20id/related",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("shows a non-blocking error for request and response failures", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network unavailable"));
    const { rerender } = render(
      <RelatedHandoffsPanel entry={entry} mode="supabase" />,
    );

    expect(await screen.findByText("関連候補を取得できませんでした。")).toBeInTheDocument();
    expect(screen.getByText("申し送りの共有には影響ありません。")).toBeInTheDocument();

    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ mode: "qdrant" }));
    rerender(
      <RelatedHandoffsPanel
        entry={{ ...entry, id: "malformed-response-entry" }}
        mode="supabase"
      />,
    );

    expect(await screen.findByText("関連候補を取得できませんでした。")).toBeInTheDocument();
  });

  it("aborts the stale request when the entry changes and on unmount", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation((_input, init) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    });
    const { rerender, unmount } = render(
      <RelatedHandoffsPanel entry={entry} mode="supabase" />,
    );

    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);

    rerender(
      <RelatedHandoffsPanel
        entry={{ ...entry, id: "new-entry" }}
        mode="supabase"
      />,
    );

    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    act(() => unmount());
    expect(signals[1].aborted).toBe(true);
  });

  it("does not fetch without a selected entry", () => {
    render(<RelatedHandoffsPanel entry={null} mode="supabase" />);

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("申し送りを選ぶと、関連候補を表示します。")).toBeInTheDocument();
  });
});
