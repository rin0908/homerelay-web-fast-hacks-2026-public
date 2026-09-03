import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authCallback: null as ((event: string) => void) | null,
  refresh: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string) => void) => {
        mocks.authCallback = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  }),
}));

import { IndeterminateSessionRecovery } from "@/components/IndeterminateSessionRecovery";

describe("IndeterminateSessionRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authCallback = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("recovers on events with a cooldown and ignores subscription setup", () => {
    const view = render(<IndeterminateSessionRecovery />);

    act(() => mocks.authCallback?.("INITIAL_SESSION"));
    expect(mocks.refresh).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new Event("focus")));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new Event("pageshow")));
    expect(mocks.refresh).toHaveBeenCalledOnce();

    act(() => {
      vi.advanceTimersByTime(10_000);
      mocks.authCallback?.("TOKEN_REFRESHED");
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);

    act(() => vi.advanceTimersByTime(50_000));
    expect(mocks.refresh).toHaveBeenCalledTimes(3);

    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
      mocks.authCallback?.("TOKEN_REFRESHED");
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });
});
