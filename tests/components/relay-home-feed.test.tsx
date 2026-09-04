import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HandoffRelay } from "@/lib/relay/types";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({})),
  createSupabaseRelay: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/relay/supabase", () => ({
  createSupabaseRelay: mocks.createSupabaseRelay,
}));

import { RelayHomeFeed } from "@/components/RelayHomeFeed";
import { DEMO_FAMILY_CONTEXT } from "@/lib/relay/contexts";
import { SYNTHETIC_ENTRIES } from "@/lib/synthetic-data";
import type { HandoffEntry } from "@/types/handoff";

function baseEntry(): HandoffEntry {
  const entry = structuredClone(SYNTHETIC_ENTRIES[0]!);
  return {
    ...entry,
    actionBy: undefined,
    neededItems: [
      {
        ...entry.neededItems[0]!,
        claimedBy: undefined,
        status: "needed",
      },
    ],
    status: "confirmed",
  };
}

function completedEntry(): HandoffEntry {
  const entry = baseEntry();
  return {
    ...entry,
    actionBy: DEMO_FAMILY_CONTEXT.member,
    neededItems: entry.neededItems.map((item) => ({
      ...item,
      claimedBy: DEMO_FAMILY_CONTEXT.member,
      status: "purchased",
    })),
    status: "done",
  };
}

function claimedItemEntry(): HandoffEntry {
  const entry = baseEntry();
  return {
    ...entry,
    neededItems: entry.neededItems.map((item) => ({
      ...item,
      claimedBy: DEMO_FAMILY_CONTEXT.member,
      status: "purchase_intent",
    })),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

describe("RelayHomeFeed optimistic actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it("responds to five rapid taps immediately and reconciles with Supabase", async () => {
    const initial = baseEntry();
    const operations = Array.from({ length: 5 }, deferred);
    const list = vi
      .fn()
      .mockResolvedValueOnce([initial])
      .mockResolvedValue([completedEntry()]);
    const relay = {
      acknowledge: vi.fn(() => operations[0]!.promise),
      claimEntry: vi.fn(() => operations[1]!.promise),
      claimItem: vi.fn(() => operations[3]!.promise),
      completeEntry: vi.fn(() => operations[2]!.promise),
      completeItem: vi.fn(() => operations[4]!.promise),
      list,
      mode: "supabase",
      publish: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    } satisfies HandoffRelay;
    mocks.createSupabaseRelay.mockReturnValue(relay);
    const user = userEvent.setup();

    render(<RelayHomeFeed context={DEMO_FAMILY_CONTEXT} mode="supabase" />);
    const conditionSummary = await screen.findByText(initial.conditionSummary);
    const mobileRecordCta = screen.getByTestId("mobile-record-cta");
    expect(
      mobileRecordCta.compareDocumentPosition(conditionSummary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "見ました" }));
    await user.click(screen.getByRole("button", { name: "私がやります" }));
    await user.click(screen.getByRole("button", { name: "できました" }));
    await user.click(screen.getByRole("button", { name: "買います" }));
    await user.click(screen.getByRole("button", { name: "買いました" }));

    expect(screen.getByRole("button", { name: "できました" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "買いました" })).toBeDisabled();
    expect(screen.getByText("タップを受け付けました。安全に反映しています…")).toBeVisible();
    expect(list).toHaveBeenCalledOnce();

    await act(async () => {
      operations.forEach((operation) => operation.resolve());
      await Promise.all(operations.map((operation) => operation.promise));
    });

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByText("タップを受け付けました。安全に反映しています…"),
      ).not.toBeInTheDocument(),
    );
  });

  it("rolls back an optimistic tap when the guarded action fails", async () => {
    const initial = baseEntry();
    const operation = deferred();
    const relay = {
      acknowledge: vi.fn(() => operation.promise),
      claimEntry: vi.fn(),
      claimItem: vi.fn(),
      completeEntry: vi.fn(),
      completeItem: vi.fn(),
      list: vi.fn().mockResolvedValue([initial]),
      mode: "supabase",
      publish: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    } satisfies HandoffRelay;
    mocks.createSupabaseRelay.mockReturnValue(relay);
    const user = userEvent.setup();

    render(<RelayHomeFeed context={DEMO_FAMILY_CONTEXT} mode="supabase" />);
    await screen.findByText(initial.conditionSummary);
    await user.click(screen.getByRole("button", { name: "見ました" }));
    expect(screen.getByRole("button", { name: "見ました" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await act(async () => operation.reject(new Error("synthetic failure")));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "見ました" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(await screen.findByText(/更新できませんでした/)).toBeVisible();
  });

  it("waits for later queued actions before the authoritative failure resync", async () => {
    const initial = baseEntry();
    const claimEntry = deferred();
    const claimItem = deferred();
    const list = vi
      .fn()
      .mockResolvedValueOnce([initial])
      .mockResolvedValue([claimedItemEntry()]);
    const relay = {
      acknowledge: vi.fn(),
      claimEntry: vi.fn(() => claimEntry.promise),
      claimItem: vi.fn(() => claimItem.promise),
      completeEntry: vi.fn(),
      completeItem: vi.fn(),
      list,
      mode: "supabase",
      publish: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    } satisfies HandoffRelay;
    mocks.createSupabaseRelay.mockReturnValue(relay);
    const user = userEvent.setup();

    render(<RelayHomeFeed context={DEMO_FAMILY_CONTEXT} mode="supabase" />);
    await screen.findByText(initial.conditionSummary);
    await user.click(screen.getByRole("button", { name: "私がやります" }));
    await user.click(screen.getByRole("button", { name: "買います" }));

    await act(async () => claimEntry.reject(new Error("synthetic failure")));

    expect(list).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "私がやります" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "買いました" })).toBeEnabled();

    await act(async () => claimItem.resolve());

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/更新できませんでした/)).toBeVisible();
  });

  it("keeps a successful prefix when a later action and the resync fail", async () => {
    const initial = baseEntry();
    const claimEntry = deferred();
    const claimItem = deferred();
    const list = vi
      .fn()
      .mockResolvedValueOnce([initial])
      .mockRejectedValueOnce(new Error("synthetic refresh failure"))
      .mockResolvedValue([initial]);
    const relay = {
      acknowledge: vi.fn(),
      claimEntry: vi.fn(() => claimEntry.promise),
      claimItem: vi.fn(() => claimItem.promise),
      completeEntry: vi.fn(),
      completeItem: vi.fn(),
      list,
      mode: "supabase",
      publish: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    } satisfies HandoffRelay;
    mocks.createSupabaseRelay.mockReturnValue(relay);
    const user = userEvent.setup();

    render(<RelayHomeFeed context={DEMO_FAMILY_CONTEXT} mode="supabase" />);
    await screen.findByText(initial.conditionSummary);
    await user.click(screen.getByRole("button", { name: "私がやります" }));
    await user.click(screen.getByRole("button", { name: "買います" }));

    await act(async () => claimEntry.resolve());
    await act(async () => claimItem.reject(new Error("synthetic failure")));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "私がやります" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "買います" })).toBeEnabled();
    expect(await screen.findByText(/保存結果を読み直せませんでした/)).toBeVisible();
  });

  it("shows only the empty-state capture link when no handoff exists", async () => {
    const relay = {
      acknowledge: vi.fn(),
      claimEntry: vi.fn(),
      claimItem: vi.fn(),
      completeEntry: vi.fn(),
      completeItem: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      mode: "supabase",
      publish: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    } satisfies HandoffRelay;
    mocks.createSupabaseRelay.mockReturnValue(relay);

    render(<RelayHomeFeed context={DEMO_FAMILY_CONTEXT} mode="supabase" />);

    await screen.findByRole("heading", {
      name: "最初の申し送りを始めましょう",
    });
    expect(screen.getAllByRole("link", { name: "カメラを開く" })).toHaveLength(1);
    expect(screen.queryByTestId("mobile-record-cta")).not.toBeInTheDocument();
  });
});
