import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HomeFeed } from "@/components/HomeFeed";
import { SYNTHETIC_ENTRIES, SYNTHETIC_MEMBERS } from "@/lib/synthetic-data";

function entries() {
  const latest = {
    ...structuredClone(SYNTHETIC_ENTRIES[0]!),
    conditionSummary: "最新の申し送り内容",
    id: "00000000-0000-4000-8000-000000001101",
  };
  const older = {
    ...structuredClone(SYNTHETIC_ENTRIES[0]!),
    conditionSummary: "過去の申し送り内容",
    id: "00000000-0000-4000-8000-000000001102",
    neededItems: [],
  };
  return [latest, older];
}

describe("HomeFeed", () => {
  it("shows the newest entry before related results and older entries", () => {
    const { container } = render(
      <HomeFeed
        afterFirstEntry={<section>関連候補パネル</section>}
        entries={entries()}
      />,
    );
    const text = container.textContent ?? "";

    expect(text.indexOf("最新の申し送り内容")).toBeLessThan(
      text.indexOf("関連候補パネル"),
    );
    expect(text.indexOf("関連候補パネル")).toBeLessThan(
      text.indexOf("過去の申し送り内容"),
    );
  });

  it("places the summary before handoff actions and handoff actions before purchase actions", () => {
    const { container } = render(
      <HomeFeed
        currentMemberId={SYNTHETIC_MEMBERS.family.id}
        entries={entries().slice(0, 1)}
        onAcknowledge={vi.fn()}
        onClaimItem={vi.fn()}
        onCompleteItem={vi.fn()}
      />,
    );
    const view = within(container);
    const summary = view.getByText("最新の申し送り内容");
    const acknowledge = view.getByRole("button", { name: "見ました" });
    const purchase = view.getByRole("button", { name: "買います" });

    expect(
      summary.compareDocumentPosition(acknowledge) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      acknowledge.compareDocumentPosition(purchase) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });
});
