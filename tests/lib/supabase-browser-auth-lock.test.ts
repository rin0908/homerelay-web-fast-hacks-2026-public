import { afterEach, describe, expect, it, vi } from "vitest";

import {
  withSupabaseBrowserAuthLock,
  withSupabaseBrowserAuthMutationLock,
} from "@/lib/supabase/browser-auth-lock";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("withSupabaseBrowserAuthLock", () => {
  it("serializes SDK auth work under its storage-key lock", async () => {
    let held = false;
    const request = vi.fn(
      async (
        name: string,
        options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => {
        expect(name).toBe("homerelay:supabase-auth-storage");
        expect(options).toEqual({
          mode: "exclusive",
          signal: expect.any(AbortSignal),
        });
        held = true;
        try {
          return await callback({ name, mode: "exclusive" } as Lock);
        } finally {
          held = false;
        }
      },
    );
    vi.stubGlobal("navigator", { locks: { request } });

    await expect(
      withSupabaseBrowserAuthLock(
        "lock:synthetic-storage-key",
        5_000,
        async () => {
          expect(held).toBe(true);
          return "done";
        },
      ),
    ).resolves.toBe("done");
    expect(held).toBe(false);
  });

  it("falls back to in-process execution where Web Locks are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const operation = vi.fn().mockResolvedValue("done");

    await expect(
      withSupabaseBrowserAuthLock("lock:synthetic", 5_000, operation),
    ).resolves.toBe("done");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("preserves the SDK's immediate auto-refresh skip semantics", async () => {
    const request = vi.fn(
      async (
        _name: string,
        options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => {
        expect(options).toEqual({ mode: "exclusive", ifAvailable: true });
        return callback(null);
      },
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const operation = vi.fn();

    await expect(
      withSupabaseBrowserAuthLock("lock:synthetic", 0, operation),
    ).rejects.toMatchObject({ isAcquireTimeout: true });
    expect(operation).not.toHaveBeenCalled();
  });

  it("bounds explicit mutation lock acquisition without starting late work", async () => {
    vi.useFakeTimers();
    const request = vi.fn(
      (_name: string, options: LockOptions) =>
        new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const operation = vi.fn();

    const result = withSupabaseBrowserAuthMutationLock(operation);
    const rejection = expect(result).rejects.toThrow(
      "supabase_browser_auth_lock_acquire_timeout",
    );
    await vi.advanceTimersByTimeAsync(20_000);

    await rejection;
    expect(operation).not.toHaveBeenCalled();
  });
});
