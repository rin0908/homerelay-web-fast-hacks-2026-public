import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseAbortingFetch } from "@/lib/supabase/aborting-fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createSupabaseAbortingFetch", () => {
  it("aborts the underlying request after the network deadline", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          receivedSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const request = createSupabaseAbortingFetch()(
      "https://synthetic.supabase.co/auth/v1/token",
    );
    const rejection = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("relays an upstream abort and removes its listener", async () => {
    const upstream = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          receivedSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const request = createSupabaseAbortingFetch()(
      "https://synthetic.supabase.co/auth/v1/user",
      { signal: upstream.signal },
    );
    upstream.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("keeps the deadline active while a response body is stalled", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            receivedSignal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return Promise.resolve(
          new Response(body, {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }),
    );

    const response = await createSupabaseAbortingFetch()(
      "https://synthetic.supabase.co/auth/v1/user",
    );
    const body = response.json();
    const rejection = expect(body).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("clears the deadline after body consumption", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined;
        return Promise.resolve(
          new Response('{"ok":true}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }),
    );

    const response = await createSupabaseAbortingFetch()(
      "https://synthetic.supabase.co/auth/v1/user",
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(receivedSignal?.aborted).toBe(false);
  });
});
