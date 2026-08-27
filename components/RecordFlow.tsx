"use client";

/* eslint-disable @next/next/no-img-element -- Local Blob preview is short-lived and never uploaded by this step. */

import { useEffect, useMemo, useRef, useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import { ConfirmDraft } from "@/components/ConfirmDraft";
import Link from "next/link";
import { Check, Send } from "@/components/Icons";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import type { DraftResult, HandoffDraft } from "@/lib/ai/draft";
import type { ProcessedImage } from "@/lib/media/image";
import { createDemoRelay } from "@/lib/relay/demo";
import { createSupabaseRelay } from "@/lib/relay/supabase";
import type {
  HandoffRelay,
  HandoffRelayContext,
  RelayMode,
  UuidString,
} from "@/lib/relay/types";
import { createClient } from "@/lib/supabase/client";

export function RecordFlow({
  context,
  mode,
}: {
  context: HandoffRelayContext;
  mode: RelayMode;
}) {
  const relay = useMemo<HandoffRelay | null>(() => {
    if (mode === "demo") return createDemoRelay(context);
    const client = createClient();
    return client
      ? createSupabaseRelay(client, { householdId: context.householdId })
      : null;
  }, [context, mode]);
  const idempotencyKey = useRef<UuidString | null>(null);
  const [accepted, setAccepted] = useState<{ photo: ProcessedImage; url: string } | null>(null);
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [confirmedDraft, setConfirmedDraft] = useState<HandoffDraft | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    return () => {
      if (accepted?.url) URL.revokeObjectURL(accepted.url);
    };
  }, [accepted?.url]);

  if (!accepted) {
    return (
      <CameraCapture
        onAccepted={(photo) => setAccepted({ photo, url: URL.createObjectURL(photo.blob) })}
      />
    );
  }

  const { photo, url: photoUrl } = accepted;

  async function shareConfirmedDraft() {
    if (!confirmedDraft || sharing) return;
    setSharing(true);
    setShareError(false);
    try {
      if (!relay) throw new Error("relay unavailable");
      idempotencyKey.current ??= crypto.randomUUID() as UuidString;
      await relay.publish({
        idempotencyKey: idempotencyKey.current,
        photo: photo.blob,
        photoAlt:
          mode === "demo"
            ? "合成デモで撮影した申し送り写真"
            : "本人確認後に共有された申し送り写真",
        conditionSummary: confirmedDraft.conditionSummary,
        completedSummary: confirmedDraft.completedSummary,
        nextRequest: confirmedDraft.nextRequest,
        neededItems: confirmedDraft.neededItems,
      });
      setShared(true);
    } catch {
      setShareError(true);
    } finally {
      setSharing(false);
    }
  }

  if (confirmedDraft) {
    if (shared) {
      return (
        <section className="soft-card p-6 text-center sm:p-9" aria-labelledby="shared-title">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
            <Check aria-hidden="true" size={28} />
          </span>
          <h2 className="mt-4 text-2xl font-semibold text-[var(--color-heading)]" id="shared-title">
            家族画面へ共有しました
          </h2>
          <p className="mt-2 text-[var(--color-secondary)]">
            {mode === "demo"
              ? "開いている合成デモの家族タブへすぐ反映されます。"
              : "ログイン済みの家族画面へリアルタイムで反映されます。"}
          </p>
          <Link className="primary-button mt-6 w-full" href="/">
            家族画面を見る
          </Link>
        </section>
      );
    }

    return (
      <section className="soft-card p-5 sm:p-8" aria-labelledby="confirmed-title">
        <div className="flex items-start gap-3 rounded-2xl bg-[#edf5f1] p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
            <Check aria-hidden="true" size={22} />
          </span>
          <div>
            <p className="eyebrow">本人確認済み</p>
            <h2 className="mt-1 text-xl font-semibold text-[var(--color-heading)]" id="confirmed-title">
              共有する内容が整いました
            </h2>
            <p className="mt-1 text-sm font-semibold text-[#85572f]">まだ家族には共有されていません</p>
          </div>
        </div>
        <dl className="mt-5 space-y-4 text-[var(--color-body)]">
          <div><dt className="text-sm font-semibold text-[var(--color-primary)]">今日の様子</dt><dd className="mt-1">{confirmedDraft.conditionSummary}</dd></div>
          {confirmedDraft.completedSummary ? <div><dt className="text-sm font-semibold text-[var(--color-primary)]">今日できたこと</dt><dd className="mt-1">{confirmedDraft.completedSummary}</dd></div> : null}
          {confirmedDraft.nextRequest ? <div><dt className="text-sm font-semibold text-[var(--color-primary)]">次の方へのお願い</dt><dd className="mt-1">{confirmedDraft.nextRequest}</dd></div> : null}
        </dl>
        {shareError ? <p className="mt-5 text-center text-sm font-semibold text-[#85572f]" role="alert">共有できませんでした。もう一度送ってください。</p> : null}
        <button className="primary-button mt-6 w-full" disabled={sharing} onClick={shareConfirmedDraft} type="button">
          <Send aria-hidden="true" size={21} />
          {shareError ? "もう一度送る" : sharing ? "共有しています…" : "次の人へ"}
        </button>
        <p className="mt-3 text-center text-xs text-[var(--color-secondary)]">
          {mode === "demo"
            ? "合成デモ：このブラウザ内だけへ共有します"
            : "本人確認済みの内容だけを世帯メンバーへ共有します"}
        </p>
      </section>
    );
  }

  if (draftResult) {
    return (
      <ConfirmDraft
        onConfirmed={setConfirmedDraft}
        onRecordAgain={() => setDraftResult(null)}
        result={draftResult}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="soft-card overflow-hidden p-5 sm:p-8" aria-labelledby="accepted-photo-title">
      <div className="overflow-hidden rounded-2xl bg-[#f2f4ef]">
        <img alt="採用した申し送り写真" className="aspect-[4/3] h-auto w-full object-cover" src={photoUrl} />
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#edf5f1] p-4 text-[var(--color-heading)]">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
          <Check aria-hidden="true" size={21} />
        </span>
        <div>
          <h2 className="font-semibold" id="accepted-photo-title">写真を選びました</h2>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            {photo.width} × {photo.height}px に整えて、端末内だけで保持しています。
          </p>
        </div>
      </div>
      </section>
      <VoiceRecorder onDraft={setDraftResult} />
    </div>
  );
}
