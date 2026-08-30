import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  parseHandoffDraftJson,
  SYNTHETIC_AI_DRAFT,
  type HandoffDraft,
} from "@/lib/ai/draft";
import { createHandoffDraft } from "@/lib/ai/openai-draft";

const openaiMocks = vi.hoisted(() => ({
  clientOptions: vi.fn(),
  transcriptionCreate: vi.fn(),
  completionCreate: vi.fn(),
  toFile: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("openai", () => {
  class OpenAIMock {
    constructor(options: unknown) {
      openaiMocks.clientOptions(options);
    }

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
  vi.stubEnv("HOMERELAY_DATA_MODE", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable");
  vi.stubEnv("OPENAI_API_KEY", "unit-test-placeholder");
  vi.stubEnv("OPENAI_PROJECT_ID", "proj_homerelay_test");
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
    openaiMocks.clientOptions.mockReset();
    openaiMocks.transcriptionCreate.mockReset();
    openaiMocks.completionCreate.mockReset();
    openaiMocks.toFile.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns an isolated synthetic fallback only in explicit demo mode", async () => {
    vi.stubEnv("HOMERELAY_DEMO_MODE", "true");
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

  it("fails closed instead of fabricating a draft when live credentials are missing", async () => {
    vi.stubEnv("HOMERELAY_DEMO_MODE", "false");
    vi.stubEnv("HOMERELAY_DATA_MODE", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_PROJECT_ID", "proj_homerelay_test");

    await expect(createHandoffDraft(audioFile())).rejects.toThrow(
      "OPENAI_NOT_CONFIGURED",
    );
    expect(openaiMocks.transcriptionCreate).not.toHaveBeenCalled();
    expect(openaiMocks.completionCreate).not.toHaveBeenCalled();
  });

  it("returns a validated live draft without making a real network request", async () => {
    useLiveOpenAI(JSON.stringify(VALID_DRAFT));

    await expect(createHandoffDraft(audioFile())).resolves.toEqual({
      mode: "live",
      draft: VALID_DRAFT,
    });
    expect(openaiMocks.transcriptionCreate).toHaveBeenCalledOnce();
    expect(openaiMocks.completionCreate).toHaveBeenCalledOnce();
    expect(openaiMocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "unit-test-placeholder",
        logLevel: "off",
        maxRetries: 0,
        project: "proj_homerelay_test",
      }),
    );
    expect(openaiMocks.completionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_completion_tokens: 800,
        reasoning_effort: "minimal",
      }),
    );
  });

  it("stops after one transcription when OpenAI returns an empty transcript", async () => {
    useLiveOpenAI(JSON.stringify(VALID_DRAFT));
    openaiMocks.transcriptionCreate.mockResolvedValue({ text: "   " });

    await expect(createHandoffDraft(audioFile())).rejects.toThrow(
      "OPENAI_TRANSCRIPT_EMPTY",
    );
    expect(openaiMocks.transcriptionCreate).toHaveBeenCalledOnce();
    expect(openaiMocks.completionCreate).not.toHaveBeenCalled();
  });

  it("uses a fixed safe classification when transcription fails", async () => {
    useLiveOpenAI(JSON.stringify(VALID_DRAFT));
    openaiMocks.transcriptionCreate.mockRejectedValue(new Error("vendor detail"));

    await expect(createHandoffDraft(audioFile())).rejects.toThrow(
      "OPENAI_TRANSCRIPTION_FAILED",
    );
    expect(openaiMocks.completionCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed structured JSON returned by OpenAI", async () => {
    useLiveOpenAI("{not-json");

    await expect(createHandoffDraft(audioFile())).rejects.toThrow(
      "OPENAI_DRAFT_SCHEMA_INVALID",
    );
  });

  it("rejects structured JSON that violates the draft schema", async () => {
    useLiveOpenAI(
      JSON.stringify({
        ...VALID_DRAFT,
        neededItems: [""],
      }),
    );

    await expect(createHandoffDraft(audioFile())).rejects.toThrow(
      "OPENAI_DRAFT_SCHEMA_INVALID",
    );
  });
});
