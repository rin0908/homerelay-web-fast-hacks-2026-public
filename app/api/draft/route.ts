import { NextResponse } from "next/server";
import { createHandoffDraft } from "@/lib/ai/openai-draft";
import {
  withAiMetrics,
  withApiMetrics,
} from "@/lib/datadog/instrumentation";
import { readBoundedRequest } from "@/lib/http/bounded-request";
import { getIntegrationStatus } from "@/lib/integration-status";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/supabase/session";

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

async function postDraft(request: Request) {
  const integration = getIntegrationStatus();
  if (integration.dataMode === "misconfigured") {
    return NextResponse.json(
      { error: "Supabase本番モードが設定されていません" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (integration.dataMode === "supabase") {
    const supabase = await createClient();
    const session = supabase ? await getCurrentSession(supabase) : null;
    if (!session) {
      return NextResponse.json(
        { error: "ログインが必要です" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const bounded = await readBoundedRequest(
    request,
    MAX_AUDIO_BYTES + 512_000,
  );
  if (bounded.status === "too_large") {
    return NextResponse.json({ error: "音声が長すぎます" }, { status: 413 });
  }
  if (bounded.status === "malformed") {
    return NextResponse.json(
      { error: "音声を読み取れませんでした" },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await bounded.request.formData();
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
    const result = await withAiMetrics(() => createHandoffDraft(audio), {
      modeOnError: integration.openai?.active ? "openai" : "synthetic",
    });
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

export const POST = withApiMetrics("draft", postDraft);
