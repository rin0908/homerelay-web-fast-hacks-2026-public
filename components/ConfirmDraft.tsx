"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Check, Mic, Sparkles } from "@/components/Icons";
import { HandoffDraftSchema, type DraftResult, type HandoffDraft } from "@/lib/ai/draft";

export type ConfirmDraftProps = {
  result: DraftResult | null;
  onConfirmed: (draft: HandoffDraft) => void;
  onRecordAgain: () => void;
};

export function ConfirmDraft({ result, onConfirmed, onRecordAgain }: ConfirmDraftProps) {
  const [conditionSummary, setConditionSummary] = useState(
    result?.draft.conditionSummary ?? "",
  );
  const [completedSummary, setCompletedSummary] = useState(
    result?.draft.completedSummary ?? "",
  );
  const [nextRequest, setNextRequest] = useState(
    result?.draft.nextRequest ?? "",
  );
  const [neededItems, setNeededItems] = useState(
    result?.draft.neededItems.join("\n") ?? "",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = HandoffDraftSchema.safeParse({
      conditionSummary,
      completedSummary,
      nextRequest,
      neededItems: neededItems
        .split(/[\n、,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    });

    if (!parsed.success) {
      setErrorMessage("短い言葉で内容を確認してください");
      return;
    }

    setErrorMessage(null);
    onConfirmed(parsed.data);
  }

  return (
    <section className="soft-card p-5 pb-28 sm:p-8" aria-labelledby="draft-title">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f1ecf8] text-[#725c87]">
          <Sparkles aria-hidden="true" size={24} />
        </span>
        <div>
          <p className="eyebrow">ステップ 3・本人確認</p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--color-heading)]" id="draft-title">
            {result ? "AI下書きを確認" : "手入力で申し送りを作成"}
          </h2>
          <p className="mt-1 text-sm font-semibold text-[#85572f]">まだ家族には共有されていません</p>
        </div>
      </div>

      <p className="mt-5 rounded-xl border border-[var(--color-divider)] bg-[#fbfaf5] px-4 py-3 text-sm text-[var(--color-body)]">
        {result?.mode === "live"
          ? "OpenAIで整えた下書きです。必ず本人が確認します。"
          : result?.mode === "demo"
            ? "合成AI下書き（OpenAI未接続）です。自由に編集できます。"
            : "AIの下書きを使わず手入力します。確認するまで共有されません。"}
      </p>

      <form className="mt-4 space-y-3 sm:mt-5 sm:space-y-5" onSubmit={submit}>
        <label className="block font-semibold text-[var(--color-heading)]">
          今日の様子
          <textarea
            className="mt-2 min-h-16 w-full rounded-xl border border-[var(--color-divider)] bg-white px-4 py-2 font-normal text-[var(--color-body)] sm:min-h-24 sm:py-3"
            maxLength={160}
            onChange={(event) => setConditionSummary(event.target.value)}
            required
            value={conditionSummary}
          />
        </label>
        <label className="block font-semibold text-[var(--color-heading)]">
          今日できたこと
          <textarea
            className="mt-2 min-h-16 w-full rounded-xl border border-[var(--color-divider)] bg-white px-4 py-2 font-normal text-[var(--color-body)] sm:min-h-20 sm:py-3"
            maxLength={160}
            onChange={(event) => setCompletedSummary(event.target.value)}
            value={completedSummary}
          />
        </label>
        <label className="block font-semibold text-[var(--color-heading)]">
          次の方へのお願い
          <textarea
            className="mt-2 min-h-16 w-full rounded-xl border border-[var(--color-divider)] bg-white px-4 py-2 font-normal text-[var(--color-body)] sm:min-h-20 sm:py-3"
            maxLength={160}
            onChange={(event) => setNextRequest(event.target.value)}
            value={nextRequest}
          />
        </label>
        <label className="block font-semibold text-[var(--color-heading)]">
          必要なもの
          <textarea
            className="mt-2 min-h-16 w-full rounded-xl border border-[var(--color-divider)] bg-white px-4 py-2 font-normal text-[var(--color-body)] sm:min-h-20 sm:py-3"
            maxLength={260}
            onChange={(event) => setNeededItems(event.target.value)}
            placeholder="1行に1つ"
            value={neededItems}
          />
        </label>

        {errorMessage ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-[#85572f]" role="alert">
            <AlertTriangle aria-hidden="true" size={19} />
            {errorMessage}
          </p>
        ) : null}

        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-30 grid grid-cols-2 gap-2 rounded-2xl bg-[#fffdf9f2] p-2 shadow-xl backdrop-blur sm:static sm:grid-cols-2 sm:gap-3 sm:bg-transparent sm:p-0 sm:shadow-none">
          <button className="secondary-button" onClick={onRecordAgain} type="button">
            <Mic aria-hidden="true" size={20} />
            もう一度話す
          </button>
          <button className="primary-button" type="submit">
            <Check aria-hidden="true" size={21} />
            これでOK
          </button>
        </div>
      </form>
    </section>
  );
}
