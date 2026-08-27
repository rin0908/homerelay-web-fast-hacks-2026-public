import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  parseHandoffDraftJson,
  SYNTHETIC_AI_DRAFT,
  type HandoffDraft,
} from "@/lib/ai/draft";
import { createHandoffDraft } from "@/lib/ai/openai-draft";

const openaiMocks = vi.hoisted(() => ({
  transcriptionCreate: vi.fn(),
  completionCreate: vi.fn(),
  toFile: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("openai", () => {
  class OpenAIMock {
    audio = {
      transcriptions: { create: openaiMocks.transcriptionCreate },
    };

    chat = {
      completions: { create: openaiMocks.completionCreate },
    };
  }

  return {
    default: OpenAIMock,
    toFile: openaiMocks.toFile,
  };
});

const VALID_DRAFT: HandoffDraft = {
  conditionSummary: "昼食は半分ほど召し上がりました",
  completedSummary: "水分を用意しました",
  nextRequest: "次に訪れた方は水分をご確認ください",
  neededItems: ["トイレットペーパー"],
};

function audioFile(): File {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const file = new File([bytes], "handoff.webm", { type: "audio/webm" });

  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => bytes.buffer.slice(0),
    });
  }

  return file;
}

function useLiveOpenAI(structuredContent: string) {
  vi.stubEnv("HOMERELAY_DEMO_MODE", "false");
  vi.stubEnv("OPENAI_API_KEY", "unit-test-placeholder");
  openaiMocks.transcriptionCreate.mockResolvedValue({ text: "合成テスト音声" });
  openaiMocks.completionCreate.mockResolvedValue({
    choices: [{ message: { content: structuredContent } }],
  });
  openaiMocks.toFile.mockResolvedValue({ name: "mock-audio.webm" });
}

describe("parseHandoffDraftJson", () => {
  it("parses a valid structured draft", () => {
    expect(parseHandoffDraftJson(JSON.stringify(VALID_DRAFT))).toEqual(VALID_DRAFT);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseHandoffDraftJson("{not-json")).toThrow(SyntaxError);
  });

  it("rejects JSON that violates the strict draft schema", () => {
    expect(() =>
      parseHandoffDraftJson(
        JSON.stringify({
          ...VALID_DRAFT,
          conditionSummary: "",
          unexpected: "not allowed",
        }),
      ),
    ).toThrow(ZodError);
  });
});

describe("createHandoffDraft", () => {
  beforeEach(() => {
    openaiMocks.transcriptionCreate.mockReset();
    openaiMocks.completionCreate.mockReset();
    openaiMocks.toFile.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns an isolated synthetic fallback when credentials are missing", async () => {
    vi.stubEnv("HOMERELAY_DEMO_MODE", "false");
    vi.stubEnv("OPENAI_API_KEY", "");

    const first = await createHandoffDraft(audioFile());

    expect(first).toEqual({ mode: "demo", draft: SYNTHETIC_AI_DRAFT });
    expect(first.draft).not.toBe(SYNTHETIC_AI_DRAFT);
    expect(openaiMocks.transcriptionCreate).not.toHaveBeenCalled();
    expect(openaiMocks.completionCreate).not.toHaveBeenCalled();
    expect(openaiMocks.toFile).not.toHaveBeenCalled();

    first.draft.conditionSummary = "mutated only inside this result";
    const second = await createHandoffDraft(audioFile());
    expect(second.draft.conditionSummary).toBe(SYNTHETIC_AI_DRAFT.conditionSummary);
  });

  it("returns a validated live draft without making a real network request", async () => {
    useLiveOpenAI(JSON.stringify(VALID_DRAFT));

    await expect(createHandoffDraft(audioFile())).resolves.toEqual({
      mode: "live",
      draft: VALID_DRAFT,
    });
    expect(openaiMocks.transcriptionCreate).toHaveBeenCalledOnce();
    expect(openaiMocks.completionCreate).toHaveBeenCalledOnce();
  });

  it("rejects malformed structured JSON returned by OpenAI", async () => {
    useLiveOpenAI("{not-json");

    await expect(createHandoffDraft(audioFile())).rejects.toThrow(SyntaxError);
  });

  it("rejects structured JSON that violates the draft schema", async () => {
    useLiveOpenAI(
      JSON.stringify({
        ...VALID_DRAFT,
        neededItems: [""],
      }),
    );

    await expect(createHandoffDraft(audioFile())).rejects.toBeInstanceOf(ZodError);
  });
});
