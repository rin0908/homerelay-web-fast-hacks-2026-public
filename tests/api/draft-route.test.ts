import { File as NodeFile } from "node:buffer";

import { FormData as UndiciFormData } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/draft/route";
import {
  createHandoffDraft,
  OpenAIDraftError,
} from "@/lib/ai/openai-draft";
import { resetOpenAIRequestGuardForTests } from "@/lib/ai/request-guard";

vi.mock("server-only", () => ({}));
vi.stubGlobal("File", NodeFile);
vi.stubGlobal("FormData", UndiciFormData);

const { createClientMock, createHandoffDraftMock, getCurrentSessionMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createHandoffDraftMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
}));

vi.mock("@/lib/ai/openai-draft", () => ({
  createHandoffDraft: createHandoffDraftMock,
  OpenAIDraftError: class OpenAIDraftError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/supabase/session", () => ({
  getCurrentSession: getCurrentSessionMock,
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
const MAX_DRAFT_BODY_BYTES = 2 * 1024 * 1024 + 512_000;

function enableAuthenticatedLiveSession() {
  vi.stubEnv("HOMERELAY_DEMO_MODE", "false");
  vi.stubEnv("HOMERELAY_DATA_MODE", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-secret");
  vi.stubEnv("OPENAI_PROJECT_ID", "proj_homerelay_test");
  createClientMock.mockResolvedValue({ synthetic: true });
  getCurrentSessionMock.mockResolvedValue({
    member: {
      householdId: "20000000-0000-4000-8000-000000000001",
      id: "10000000-0000-4000-8000-000000000001",
    },
    userId: "30000000-0000-4000-8000-000000000001",
  });
}

function audioFile(contents: BlobPart[], type = "audio/webm") {
  return new File(contents, "handoff.webm", { type });
}

async function requestWithAudio(
  audio: File | null,
  contentLength?: number,
  options: {
    durationMs?: string | null;
    headers?: Record<string, string>;
    url?: string;
  } = {},
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
  const durationMs =
    options.durationMs === undefined ? "1000" : options.durationMs;
  if (durationMs !== null) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="durationMs"\r\n\r\n${durationMs}\r\n`,
      ),
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
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value);
  }

  return new Request(options.url ?? "http://localhost/api/draft", {
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
    vi.stubEnv("HOMERELAY_DEMO_MODE", "true");
    resetOpenAIRequestGuardForTests();
    createClientMock.mockReset();
    createHandoffDraftMock.mockReset();
    createHandoffDraftMock.mockResolvedValue(VALID_RESULT);
    getCurrentSessionMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it.each([
    ["missing", null, 400, "録音時間を確認できません"],
    ["too long", "30001", 413, "音声が長すぎます"],
  ])("rejects %s declared audio duration", async (_label, durationMs, status, error) => {
    const response = await POST(
      await requestWithAudio(audioFile(["voice"]), undefined, { durationMs }),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
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

  it("rejects an audio file over 2 MiB", async () => {
    const oversizedAudio = audioFile(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
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

  it("exposes only a fixed error class during an explicit local live verification", async () => {
    const verificationToken = "synthetic-route-verifier-token-00000001";
    vi.stubEnv("HOMERELAY_OPENAI_VERIFY", "true");
    vi.stubEnv("HOMERELAY_OPENAI_VERIFY_TOKEN", verificationToken);
    createHandoffDraftMock.mockRejectedValueOnce(
      new OpenAIDraftError("OPENAI_DRAFT_EMPTY"),
    );

    const response = await POST(
      await requestWithAudio(audioFile(["voice"]), undefined, {
        headers: { "X-HomeRelay-OpenAI-Verify": verificationToken },
      }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("x-homerelay-ai-error-class")).toBe(
      "OPENAI_DRAFT_EMPTY",
    );
    await expect(response.json()).resolves.toEqual({
      error: "AIの下書きを作れませんでした",
    });
    expect(createHandoffDraftMock).toHaveBeenCalledWith(expect.any(File), {
      forceLive: true,
    });
  });

  it("does not expose verification details without the loopback verifier header", async () => {
    const verificationToken = "synthetic-route-verifier-token-00000001";
    vi.stubEnv("HOMERELAY_OPENAI_VERIFY", "true");
    vi.stubEnv("HOMERELAY_OPENAI_VERIFY_TOKEN", verificationToken);
    createHandoffDraftMock.mockRejectedValueOnce(
      new OpenAIDraftError("OPENAI_DRAFT_EMPTY"),
    );

    const response = await POST(
      await requestWithAudio(audioFile(["voice"]), undefined, {
        headers: { "X-HomeRelay-OpenAI-Verify": verificationToken },
        url: "https://outside.example.test/api/draft",
      }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("x-homerelay-ai-error-class")).toBeNull();
    expect(createHandoffDraftMock).toHaveBeenCalledWith(expect.any(File), {
      forceLive: false,
    });
  });

  it("refuses a mismatched verifier token even on loopback", async () => {
    vi.stubEnv("HOMERELAY_OPENAI_VERIFY", "true");
    vi.stubEnv(
      "HOMERELAY_OPENAI_VERIFY_TOKEN",
      "synthetic-route-verifier-token-00000001",
    );
    createHandoffDraftMock.mockRejectedValueOnce(
      new OpenAIDraftError("OPENAI_DRAFT_EMPTY"),
    );

    const response = await POST(
      await requestWithAudio(audioFile(["voice"]), undefined, {
        headers: {
          "X-HomeRelay-OpenAI-Verify":
            "synthetic-route-verifier-token-00000002",
        },
      }),
    );

    expect(response.headers.get("x-homerelay-ai-error-class")).toBeNull();
    expect(createHandoffDraftMock).toHaveBeenCalledWith(expect.any(File), {
      forceLive: false,
    });
  });

  it.each(["flag-off", "production"])(
    "never enables the verifier bypass in %s mode",
    async (mode) => {
      const verificationToken = "synthetic-route-verifier-token-00000001";
      vi.stubEnv(
        "HOMERELAY_OPENAI_VERIFY",
        mode === "flag-off" ? "false" : "true",
      );
      vi.stubEnv("HOMERELAY_OPENAI_VERIFY_TOKEN", verificationToken);
      if (mode === "production") vi.stubEnv("NODE_ENV", "production");
      createHandoffDraftMock.mockRejectedValueOnce(
        new OpenAIDraftError("OPENAI_DRAFT_EMPTY"),
      );

      const response = await POST(
        await requestWithAudio(audioFile(["voice"]), undefined, {
          headers: { "X-HomeRelay-OpenAI-Verify": verificationToken },
        }),
      );

      expect(response.headers.get("x-homerelay-ai-error-class")).toBeNull();
      expect(createHandoffDraftMock).toHaveBeenCalledWith(expect.any(File), {
        forceLive: false,
      });
    },
  );

  it("requires an authenticated Supabase session before a paid live call", async () => {
    vi.stubEnv("HOMERELAY_DEMO_MODE", "false");
    vi.stubEnv("HOMERELAY_DATA_MODE", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-secret");
    vi.stubEnv("OPENAI_PROJECT_ID", "proj_homerelay_test");
    createClientMock.mockResolvedValue({ synthetic: true });
    getCurrentSessionMock.mockResolvedValue(null);

    const response = await POST(await requestWithAudio(audioFile(["voice"])));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createHandoffDraftMock).not.toHaveBeenCalled();
  });

  it("returns a no-store live draft for an authenticated Supabase member", async () => {
    enableAuthenticatedLiveSession();
    const liveResult = { ...VALID_RESULT, mode: "live" as const };
    createHandoffDraftMock.mockResolvedValueOnce(liveResult);

    const response = await POST(await requestWithAudio(audioFile(["voice"])));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(liveResult);
    expect(createHandoffDraftMock).toHaveBeenCalledWith(expect.any(File), {
      forceLive: false,
    });
  });

  it("rate limits a fourth paid attempt by the same member", async () => {
    enableAuthenticatedLiveSession();
    createHandoffDraftMock.mockResolvedValue({ ...VALID_RESULT, mode: "live" });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await POST(await requestWithAudio(audioFile([`voice-${attempt}`])));
      expect(response.status).toBe(200);
    }
    const limited = await POST(await requestWithAudio(audioFile(["voice-4"])));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(createHandoffDraftMock).toHaveBeenCalledTimes(3);
  });
});
