import "server-only";

import OpenAI, { toFile } from "openai";
import { getIntegrationStatus } from "@/lib/integration-status";
import {
  HandoffDraftSchema,
  parseHandoffDraftJson,
  SYNTHETIC_AI_DRAFT,
  type DraftResult,
  type HandoffDraft,
} from "@/lib/ai/draft";

const HANDOFF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["conditionSummary", "completedSummary", "nextRequest", "neededItems"],
  properties: {
    conditionSummary: { type: "string", maxLength: 160 },
    completedSummary: { type: "string", maxLength: 160 },
    nextRequest: { type: "string", maxLength: 160 },
    neededItems: {
      type: "array",
      maxItems: 5,
      items: { type: "string", maxLength: 50 },
    },
  },
} as const;

const SYSTEM_INSTRUCTIONS = `あなたはHomeRelayの家族向け申し送り下書きを作ります。
話された内容だけを、温かく簡潔な日本語に整えてください。
発言にない事実を足さず、診断、服薬変更、医療判断、緊急度の推測はしないでください。
conditionSummaryは今日の様子、completedSummaryは今日できたこと、nextRequestは次の方へのお願いです。
該当内容がなければconditionSummary以外は空文字または空配列にしてください。`;

function extensionForMimeType(mimeType: string) {
  const baseType = mimeType.split(";", 1)[0];
  return (
    {
      "audio/mp4": "m4a",
      "audio/mpeg": "mp3",
      "audio/ogg": "ogg",
      "audio/wav": "wav",
      "audio/webm": "webm",
    }[baseType] ?? "webm"
  );
}

async function createLiveDraft(audio: File): Promise<HandoffDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI credentials are unavailable");

  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 25_000 });
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const upload = await toFile(bytes, `homerelay-audio.${extensionForMimeType(audio.type)}`, {
    type: audio.type,
  });

  const transcription = await client.audio.transcriptions.create({
    file: upload,
    language: "ja",
    model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
    response_format: "json",
  });

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTIONS },
      { role: "user", content: transcription.text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "homerelay_handoff_draft",
        description: "A concise, human-confirmed HomeRelay handoff draft",
        strict: true,
        schema: HANDOFF_JSON_SCHEMA,
      },
    },
  });

  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("OpenAI returned no structured draft");
  return HandoffDraftSchema.parse(parseHandoffDraftJson(content));
}

export async function createHandoffDraft(audio: File): Promise<DraftResult> {
  if (!getIntegrationStatus().openai.active) {
    return { mode: "demo", draft: structuredClone(SYNTHETIC_AI_DRAFT) };
  }

  return { mode: "live", draft: await createLiveDraft(audio) };
}
