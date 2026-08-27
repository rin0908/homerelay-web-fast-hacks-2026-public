import { File as NodeFile } from "node:buffer";

import { FormData as UndiciFormData } from "undici";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubGlobal("File", NodeFile);
vi.stubGlobal("FormData", UndiciFormData);

import { readBoundedRequest } from "@/lib/http/bounded-request";

function streamingRequest(
  chunks: readonly Uint8Array[],
  options: Readonly<{
    close?: boolean;
    headers?: HeadersInit;
  }> = {},
) {
  let cancelled = false;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue(chunk);
      } else if (options.close !== false) {
        controller.close();
      }
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    body: stream,
    duplex: "half",
    headers: options.headers,
    method: "POST",
  };

  return {
    cancelled: () => cancelled,
    request: new Request("http://localhost/api/synthetic", init),
  };
}

describe("readBoundedRequest", () => {
  it("reconstructs a normal declared body without forwarding transport headers", async () => {
    const body = new TextEncoder().encode('{"synthetic":true}');
    const { request } = streamingRequest([body], {
      headers: {
        "content-length": String(body.byteLength),
        "content-type": "application/json",
      },
    });

    const result = await readBoundedRequest(request, body.byteLength);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.byteLength).toBe(body.byteLength);
    expect(result.request.headers.get("content-length")).toBeNull();
    expect(result.request.headers.get("content-type")).toBe("application/json");
    await expect(result.request.json()).resolves.toEqual({ synthetic: true });
  });

  it("accepts a chunked body exactly at the actual-byte boundary", async () => {
    const { request } = streamingRequest([
      Uint8Array.from([1, 2]),
      Uint8Array.from([3, 4]),
    ]);

    const result = await readBoundedRequest(request, 4);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.byteLength).toBe(4);
    expect(new Uint8Array(await result.request.arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );
  });

  it("preserves a multipart boundary for native FormData reconstruction", async () => {
    const boundary = "homerelay-synthetic-boundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="audio"; filename="handoff.webm"',
      "Content-Type: audio/webm",
      "",
      "voice",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const request = new Request("http://localhost/api/synthetic", {
      body,
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      method: "POST",
    });

    const result = await readBoundedRequest(request, 1_024);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const formData = await result.request.formData();
    const audio = formData.get("audio");
    expect(audio).toBeInstanceOf(File);
    if (!(audio instanceof File)) return;
    expect(audio.name).toBe("handoff.webm");
    expect(audio.size).toBe(5);
    expect(audio.type).toBe("audio/webm");
  });

  it("cancels a chunked body as soon as actual bytes exceed the limit", async () => {
    const source = streamingRequest(
      [new Uint8Array(4), Uint8Array.from([1])],
      { close: false },
    );

    await expect(readBoundedRequest(source.request, 4)).resolves.toEqual({
      status: "too_large",
    });
    expect(source.cancelled()).toBe(true);
  });

  it.each(["-1", "1.5", "1e2", "1, 1", "not-a-number"])(
    "rejects malformed Content-Length %s and cancels the body",
    async (contentLength) => {
      const source = streamingRequest([Uint8Array.from([1])], {
        close: false,
        headers: { "content-length": contentLength },
      });

      await expect(readBoundedRequest(source.request, 4)).resolves.toEqual({
        status: "malformed",
      });
      expect(source.cancelled()).toBe(true);
    },
  );

  it("rejects a declared length that does not match the completed body", async () => {
    const { request } = streamingRequest([Uint8Array.from([1, 2, 3])], {
      headers: { "content-length": "4" },
    });

    await expect(readBoundedRequest(request, 4)).resolves.toEqual({
      status: "malformed",
    });
  });
});
