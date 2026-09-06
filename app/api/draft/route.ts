import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import {
  createHandoffDraft,
  OpenAIDraftError,
} from "@/lib/ai/openai-draft";
import { acquireOpenAIRequestSlot } from "@/lib/ai/request-guard";
import {
  withAiMetrics,
  withApiMetrics,
} from "@/lib/datadog/instrumentation";
import { readBoundedRequest } from "@/lib/http/bounded-request";
import { getIntegrationStatus } from "@/lib/integration-status";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/supabase/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 30_000;
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

function isLocalOpenAIVerification(request: Request) {
  const expectedToken = process.env.HOMERELAY_OPENAI_VERIFY_TOKEN?.trim() ?? "";
  const suppliedToken = request.headers.get("x-homerelay-openai-verify") ?? "";
  const expectedBytes = Buffer.from(expectedToken);
  const suppliedBytes = Buffer.from(suppliedToken);
  const tokenMatches =
    expectedToken.length >= 32 &&
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes);

  if (
    process.env.NODE_ENV === "production" ||
    process.env.HOMERELAY_OPENAI_VERIFY !== "true" ||
    !tokenMatches
  ) {
    return false;
  }

  const url = new URL(request.url);
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  );
}

async function postDraft(request: Request) {
  const integration = getIntegrationStatus();
  const localVerification = isLocalOpenAIVerification(request);
  let paidSubject = localVerification
    ? { householdId: "local-verifier", memberId: "local-verifier" }
    : null;
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
    paidSubject = {
      householdId: session.member.householdId,
      memberId: session.member.id,
    };
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

  const durationValue = formData.get("durationMs");
  if (typeof durationValue !== "string" || !/^\d+$/.test(durationValue)) {
    return NextResponse.json({ error: "録音時間を確認できません" }, { status: 400 });
  }
  const durationMs = Number(durationValue);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
    return NextResponse.json({ error: "録音時間を確認できません" }, { status: 400 });
  }
  if (durationMs > MAX_AUDIO_DURATION_MS) {
    return NextResponse.json({ error: "音声が長すぎます" }, { status: 413 });
  }

  const paidRequest = integration.openai.active || localVerification;
  const slot =
    paidRequest && paidSubject
      ? acquireOpenAIRequestSlot(paidSubject)
      : null;
  if (slot && slot.status !== "allowed") {
    return NextResponse.json(
      { error: "少し待ってから、もう一度お試しください" },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(slot.retryAfterSeconds),
        },
      },
    );
  }

  try {
    const result = await withAiMetrics(
      () => createHandoffDraft(audio, { forceLive: localVerification }),
      {
        modeOnError:
          integration.openai.active || localVerification ? "openai" : "synthetic",
      },
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const verificationHeaders: Record<string, string> = {
      "Cache-Control": "no-store",
    };
    if (localVerification && error instanceof OpenAIDraftError) {
      verificationHeaders["X-HomeRelay-AI-Error-Class"] = error.code;
    }
    return NextResponse.json(
      { error: "AIの下書きを作れませんでした" },
      { status: 502, headers: verificationHeaders },
    );
  } finally {
    if (slot?.status === "allowed") slot.release();
  }
}

export const POST = withApiMetrics("draft", postDraft);
