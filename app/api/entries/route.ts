import { NextResponse } from "next/server";

import {
  MAX_PUBLISH_BODY_BYTES,
  parsePublishFields,
  validatePhoto,
} from "@/lib/entries/publish";
import { getIntegrationStatus } from "@/lib/integration-status";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/supabase/session";

export const runtime = "nodejs";

const PHOTO_BUCKET = "handoff-photos";

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function databaseErrorStatus(error: { code?: string; message?: string }) {
  if (error.code === "42501") return 403;
  if (error.code === "22023" && error.message === "idempotency_conflict") {
    return 409;
  }
  if (error.code === "22023") return 400;
  return 502;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function POST(request: Request) {
  const integration = getIntegrationStatus();
  if (integration.dataMode !== "supabase") {
    return jsonError("Supabase本番モードが設定されていません", 503);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_PUBLISH_BODY_BYTES) {
    return jsonError("写真が大きすぎます", 413);
  }

  const supabase = await createClient();
  if (!supabase) return jsonError("Supabaseへ接続できません", 503);

  const session = await getCurrentSession(supabase);
  if (!session) return jsonError("ログインが必要です", 401);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("共有内容を読み取れませんでした", 400);
  }

  const fields = parsePublishFields(formData);
  const photo = await validatePhoto(formData.get("photo"));
  if (!fields || !photo) {
    return jsonError("共有内容または写真を確認してください", 400);
  }
  const photoSha256 = await sha256Hex(photo.file);

  const photoPath = [
    session.member.householdId,
    session.member.id,
    `${fields.idempotencyKey}.${photo.extension}`,
  ].join("/");
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  const { error: uploadError } = await bucket.upload(photoPath, photo.file, {
    cacheControl: "3600",
    contentType: photo.file.type,
    upsert: false,
  });

  let createdObject = !uploadError;
  if (uploadError) {
    // An idempotent retry may find the object already uploaded. Verify that the
    // current authenticated member can read that exact scoped object.
    const { data: existingObject, error: existingError } =
      await bucket.download(photoPath);
    if (existingError || !existingObject) {
      return jsonError("写真を保存できませんでした", 502);
    }
    createdObject = false;
  }

  const { data: entryId, error: shareError } = await supabase.rpc(
    "share_handoff",
    {
      p_completed_summary: fields.completedSummary,
      p_condition_summary: fields.conditionSummary,
      p_idempotency_key: fields.idempotencyKey,
      p_needed_items: fields.neededItems,
      p_next_request: fields.nextRequest,
      p_photo_alt: fields.photoAlt,
      p_photo_path: photoPath,
      p_photo_sha256: photoSha256,
    },
  );

  if (shareError || typeof entryId !== "string") {
    const definitelyRejected =
      shareError && ["22023", "42501", "P0001"].includes(shareError.code ?? "");
    if (createdObject && definitelyRejected) {
      await bucket.remove([photoPath]);
    }
    const status = shareError ? databaseErrorStatus(shareError) : 502;
    return jsonError(
      status === 409
        ? "同じ共有操作の内容が一致しません"
        : "申し送りを共有できませんでした",
      status,
    );
  }

  return NextResponse.json(
    { entryId },
    {
      status: createdObject ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
