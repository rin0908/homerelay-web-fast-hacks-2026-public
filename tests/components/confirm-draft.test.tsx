import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDraft } from "@/components/ConfirmDraft";
import type { DraftResult } from "@/lib/ai/draft";

const result: DraftResult = {
  mode: "demo",
  draft: {
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "次に訪れた方は水分をご確認ください",
    neededItems: ["トイレットペーパー"],
  },
};

describe("ConfirmDraft", () => {
  afterEach(() => cleanup());

  it("shows the successful draft and confirms the user's edits", async () => {
    const onConfirmed = vi.fn();
    const onRecordAgain = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDraft
        onConfirmed={onConfirmed}
        onRecordAgain={onRecordAgain}
        result={result}
      />,
    );

    expect(screen.getByText("AI下書きを確認")).toBeInTheDocument();
    expect(
      screen.getByText("合成AI下書き（OpenAI未接続）です。自由に編集できます。"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue(result.draft.conditionSummary)).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();

    const condition = screen.getByLabelText("今日の様子");
    const completed = screen.getByLabelText("今日できたこと");
    const nextRequest = screen.getByLabelText("次の方へのお願い");
    const neededItems = screen.getByLabelText("必要なもの");

    await user.clear(condition);
    await user.type(condition, "夕食はほぼ召し上がりました");
    await user.clear(completed);
    await user.type(completed, "食後のお茶を用意しました");
    await user.clear(nextRequest);
    await user.type(nextRequest, "次の方は室温をご確認ください");
    await user.clear(neededItems);
    await user.type(neededItems, "ティッシュ{enter}手袋、電池");

    await user.click(screen.getByRole("button", { name: "これでOK" }));

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith({
      conditionSummary: "夕食はほぼ召し上がりました",
      completedSummary: "食後のお茶を用意しました",
      nextRequest: "次の方は室温をご確認ください",
      neededItems: ["ティッシュ", "手袋", "電池"],
    });
    expect(onRecordAgain).not.toHaveBeenCalled();
  });

  it("lets the user choose another recording without confirming the draft", async () => {
    const onConfirmed = vi.fn();
    const onRecordAgain = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDraft
        onConfirmed={onConfirmed}
        onRecordAgain={onRecordAgain}
        result={result}
      />,
    );

    await user.click(screen.getByRole("button", { name: "もう一度話す" }));

    expect(onRecordAgain).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});
