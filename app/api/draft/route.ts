import { NextResponse } from "next/server";
import { createHandoffDraft } from "@/lib/ai/openai-draft";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_AUDIO_TYPES = new Set([
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

function baseMimeType(type: string) {
  return type.split(";", 1)[0].toLowerCase();
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_AUDIO_BYTES + 512_000) {
    return NextResponse.json({ error: "音声が長すぎます" }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "音声を読み取れませんでした" }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "音声がありません" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "音声が長すぎます" }, { status: 413 });
  }
  if (!ACCEPTED_AUDIO_TYPES.has(baseMimeType(audio.type))) {
    return NextResponse.json({ error: "この音声形式には対応していません" }, { status: 415 });
  }

  try {
    const result = await createHandoffDraft(audio);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "AIの下書きを作れませんでした" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
