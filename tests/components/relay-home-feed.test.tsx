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
    await screen.findByText(initial.conditionSummary);

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
});
