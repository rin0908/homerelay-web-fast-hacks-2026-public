import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(),
  login: vi.fn(),
}));

vi.mock("@/app/login/actions", () => ({
  login: mocks.login,
}));
vi.mock("@/lib/supabase/env", () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

import LoginPage from "@/app/login/page";

function page(searchParams: Record<string, string | string[] | undefined> = {}) {
  return LoginPage({ searchParams: Promise.resolve(searchParams) });
}

describe("invited member login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a non-blocking synthetic demo path when Supabase is unavailable", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);

    render(await page());

    expect(screen.getByLabelText("合成デモモード")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "合成デモへ戻る" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "ログイン" })).not.toBeInTheDocument();
  });

  it("renders only invited-member password login when configured", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(true);

    render(await page());

    expect(
      screen.getByRole("heading", { name: "招待済みメンバーのログイン" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("メールアドレス")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("パスワード")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByRole("button", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.getByText(/公開サインアップはありません/)).toBeInTheDocument();
    expect(screen.queryByText(/アカウント作成|新規登録/)).not.toBeInTheDocument();
  });

  it("shows safe status and known error messages", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(true);

    render(await page({ error: "membership", loggedOut: "1" }));

    expect(screen.getByRole("status")).toHaveTextContent("ログアウトしました");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "招待された世帯メンバーであることを確認できませんでした",
    );
  });
});
