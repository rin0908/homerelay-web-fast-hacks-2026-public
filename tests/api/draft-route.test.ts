import { File as NodeFile } from "node:buffer";

import { FormData as UndiciFormData } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/draft/route";
import { createHandoffDraft } from "@/lib/ai/openai-draft";

vi.mock("server-only", () => ({}));
vi.stubGlobal("File", NodeFile);
vi.stubGlobal("FormData", UndiciFormData);

const { createHandoffDraftMock } = vi.hoisted(() => ({
  createHandoffDraftMock: vi.fn(),
}));

vi.mock("@/lib/ai/openai-draft", () => ({
  createHandoffDraft: createHandoffDraftMock,
}));

const VALID_RESULT = {
  mode: "demo" as const,
  draft: {
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "次に訪れた方は水分をご確認ください",
    neededItems: ["トイレットペーパー"],
  },
};
const MAX_DRAFT_BODY_BYTES = 10 * 1024 * 1024 + 512_000;

function audioFile(contents: BlobPart[], type = "audio/webm") {
  return new File(contents, "handoff.webm", { type });
}

async function requestWithAudio(
  audio: File | null,
  contentLength?: number,
): Promise<Request> {
  const boundary = "homerelay-synthetic-audio-boundary";
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  if (audio) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${audio.name}"\r\nContent-Type: ${audio.type}\r\n\r\n`,
      ),
      new Uint8Array(await audio.arrayBuffer()),
      encoder.encode("\r\n"),
    );
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers();
  headers.set("content-type", `multipart/form-data; boundary=${boundary}`);
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }

  return new Request("http://localhost/api/draft", {
    body,
    headers,
    method: "POST",
  });
}

function streamingRequest(chunks: readonly Uint8Array[]) {
  let cancelled = false;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue(chunk);
      }
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    body,
    duplex: "half",
    headers: { "Content-Type": "multipart/form-data; boundary=synthetic" },
    method: "POST",
  };

  return {
    cancelled: () => cancelled,
    request: new Request("http://localhost/api/draft", init),
  };
}

describe("POST /api/draft", () => {
  beforeEach(() => {
    createHandoffDraftMock.mockReset();
    createHandoffDraftMock.mockResolvedValue(VALID_RESULT);
  });

  it("accepts a valid audio request and returns a no-store draft", async () => {
    const audio = audioFile(["voice"], "audio/webm;codecs=opus");

    const response = await POST(await requestWithAudio(audio));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(VALID_RESULT);
    expect(vi.mocked(createHandoffDraft)).toHaveBeenCalledOnce();
    const draftedAudio = createHandoffDraftMock.mock.calls[0][0] as File;
    expect(draftedAudio).toBeInstanceOf(File);
    expect(draftedAudio.name).toBe(audio.name);
    expect(draftedAudio.size).toBe(audio.size);
    expect(draftedAudio.type).toBe(audio.type);
  });

  it.each([
    ["missing", null],
    ["empty", audioFile([], "audio/webm")],
  ])("rejects %s audio", async (_label, audio) => {
    const response = await POST(await requestWithAudio(audio));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "音声がありません" });
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type", async () => {
    const response = await POST(
      await requestWithAudio(audioFile(["voice"], "text/plain")),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: "この音声形式には対応していません",
    });
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared request before parsing the form", async () => {
    const request = await requestWithAudio(
      audioFile(["voice"]),
      MAX_DRAFT_BODY_BYTES + 1,
    );

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "音声が長すぎます" });
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("cancels a chunked request that exceeds the actual-byte limit", async () => {
    const source = streamingRequest([
      new Uint8Array(MAX_DRAFT_BODY_BYTES),
      Uint8Array.from([1]),
    ]);

    expect(source.request.headers.get("content-length")).toBeNull();
    const response = await POST(source.request);

    expect(response.status).toBe(413);
    expect(source.cancelled()).toBe(true);
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed Content-Length", async () => {
    const request = await requestWithAudio(audioFile(["voice"]));
    request.headers.set("content-length", "invalid");

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "音声を読み取れませんでした",
    });
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("rejects an audio file over 10 MiB", async () => {
    const oversizedAudio = audioFile(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "audio/webm",
    );

    const response = await POST(await requestWithAudio(oversizedAudio));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "音声が長すぎます" });
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("returns a safe 502 response when structured draft creation fails", async () => {
    createHandoffDraftMock.mockRejectedValueOnce(new Error("mock structured output failure"));

    const response = await POST(
      await requestWithAudio(audioFile(["voice"])),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "AIの下書きを作れませんでした",
    });
  });
});
