import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthSessionLockAcquireTimeoutError,
  AuthSessionLockUnavailableError,
  supportsAuthSessionLock,
  withAuthSessionLock,
} from "@/lib/supabase/auth-session-lock";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("auth session lock", () => {
  it("reports an unavailable Web Locks API and does not run the operation", async () => {
    vi.stubGlobal("navigator", {});
    const operation = vi.fn();

    expect(supportsAuthSessionLock()).toBe(false);
    await expect(withAuthSessionLock(operation)).rejects.toBeInstanceOf(
      AuthSessionLockUnavailableError,
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it("uses the exact shared name and exclusive options and returns the result", async () => {
    const request = vi.fn(
      async (
        name: string,
        options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => callback({ name, mode: options.mode ?? "exclusive" } as Lock),
    );
    vi.stubGlobal("navigator", { locks: { request } });

    expect(supportsAuthSessionLock()).toBe(true);
    await expect(
      withAuthSessionLock(async () => "synthetic-result"),
    ).resolves.toBe("synthetic-result");
    expect(request).toHaveBeenCalledWith(
      "homerelay:auth-session",
      { mode: "exclusive" },
      expect.any(Function),
    );
  });

  it("preserves an operation rejection after the lock is acquired", async () => {
    const failure = new Error("synthetic-operation-failure");
    const request = vi.fn(
      async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => callback({ name, mode: "exclusive" } as Lock),
    );
    vi.stubGlobal("navigator", { locks: { request } });

    await expect(
      withAuthSessionLock(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("aborts only while acquisition is queued", async () => {
    vi.useFakeTimers();
    const operation = vi.fn();
    const request = vi.fn(
      (
        _name: string,
        options: LockOptions,
      ) =>
        new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("navigator", { locks: { request } });

    const result = withAuthSessionLock(operation, { acquireTimeoutMs: 25 });
    const rejection = expect(result).rejects.toBeInstanceOf(
      AuthSessionLockAcquireTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(operation).not.toHaveBeenCalled();
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      mode: "exclusive",
      signal: expect.any(AbortSignal),
    });
  });

  it("does not abort an auth operation after acquisition", async () => {
    vi.useFakeTimers();
    const request = vi.fn(
      async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => callback({ name, mode: "exclusive" } as Lock),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    let finishOperation!: () => void;
    const operationCanFinish = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });
    const operation = vi.fn(async () => {
      await operationCanFinish;
      return "finished";
    });

    const result = withAuthSessionLock(operation, { acquireTimeoutMs: 25 });
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(100);
    finishOperation();

    await expect(result).resolves.toBe("finished");
  });
});
