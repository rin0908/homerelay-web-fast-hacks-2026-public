import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntryCard } from "@/components/EntryCard";
import { HomeFeed } from "@/components/HomeFeed";
import { RoleBadge } from "@/components/RoleBadge";
import { SYNTHETIC_ENTRIES } from "@/lib/synthetic-data";

describe("warm UI shell", () => {
  it("renders every allowed role as text", () => {
    render(
      <div>
        <RoleBadge role="family" />
        <RoleBadge role="relative" />
        <RoleBadge role="helper" />
      </div>,
    );

    expect(screen.getByText("ご家族")).toBeInTheDocument();
    expect(screen.getByText("ご親族")).toBeInTheDocument();
    expect(screen.getByText("訪問ヘルパー")).toBeInTheDocument();
  });

  it("renders the exact handoff and purchase labels", () => {
    const { container } = render(<EntryCard entry={SYNTHETIC_ENTRIES[0]} />);

    expect(screen.getByRole("button", { name: "確認しました" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "私が対応します" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "対応しました" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "購入します" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "購入しました" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/買います|買いました|届けました|補充しました|補充済み/);
  });

  it("keeps loading, empty, and error states short and actionable", () => {
    const { rerender } = render(<HomeFeed entries={[]} status="loading" />);
    expect(screen.getByLabelText("申し送りを読み込み中")).toHaveAttribute("aria-busy", "true");

    rerender(<HomeFeed entries={[]} status="empty" />);
    expect(screen.getByRole("heading", { name: "最初の申し送りを始めましょう" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "写真を撮る" })).toHaveAttribute("href", "/record");

    rerender(<HomeFeed entries={[]} status="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("うまく読み込めませんでした");
  });
});
