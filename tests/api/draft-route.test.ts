import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/draft/route";
import { createHandoffDraft } from "@/lib/ai/openai-draft";

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

function audioFile(contents: BlobPart[], type = "audio/webm") {
  return new File(contents, "handoff.webm", { type });
}

function requestWithAudio(audio: File | null, contentLength?: number): Request {
  const headers = new Headers();
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }

  return {
    headers,
    formData: vi.fn(async () => ({
      get: (name: string) => (name === "audio" ? audio : null),
    })),
  } as unknown as Request;
}

describe("POST /api/draft", () => {
  beforeEach(() => {
    createHandoffDraftMock.mockReset();
    createHandoffDraftMock.mockResolvedValue(VALID_RESULT);
  });

  it("accepts a valid audio request and returns a no-store draft", async () => {
    const audio = audioFile(["voice"], "audio/webm;codecs=opus");

    const response = await POST(requestWithAudio(audio));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(VALID_RESULT);
    expect(vi.mocked(createHandoffDraft)).toHaveBeenCalledOnce();
    expect(vi.mocked(createHandoffDraft)).toHaveBeenCalledWith(audio);
  });

  it.each([
    ["missing", null],
    ["empty", audioFile([], "audio/webm")],
  ])("rejects %s audio", async (_label, audio) => {
    const response = await POST(requestWithAudio(audio));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "音声がありません" });
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type", async () => {
    const response = await POST(requestWithAudio(audioFile(["voice"], "text/plain")));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: "この音声形式には対応していません",
    });
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared request before parsing the form", async () => {
    const formData = vi.fn();
    const request = {
      headers: new Headers({ "content-length": String(10 * 1024 * 1024 + 512_001) }),
      formData,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "音声が長すぎます" });
    expect(formData).not.toHaveBeenCalled();
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("rejects an audio file over 10 MiB", async () => {
    const oversizedAudio = audioFile(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "audio/webm",
    );

    const response = await POST(requestWithAudio(oversizedAudio));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "音声が長すぎます" });
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("returns a safe 502 response when structured draft creation fails", async () => {
    createHandoffDraftMock.mockRejectedValueOnce(new Error("mock structured output failure"));

    const response = await POST(requestWithAudio(audioFile(["voice"])));

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "AIの下書きを作れませんでした",
    });
  });
});
