import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/app/login/LoginForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LoginForm", () => {
  function submitFilledForm() {
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "family@example.test" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "ログイン" }).closest("form")!,
    );
  }

  async function fillAndSubmit() {
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled(),
    );
    submitFilledForm();
  }

  it("holds the shared auth lock, blocks double-submit, and exposes pending state", async () => {
    let lockHeld = false;
    const request = vi.fn(
      async (
        _name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => {
        lockHeld = true;
        try {
          return await callback({
            name: "homerelay:auth-session",
            mode: "exclusive",
          } as Lock);
        } finally {
          lockHeld = false;
        }
      },
    );
    vi.stubGlobal("navigator", { locks: { request } });

    let finishLogin!: () => void;
    const loginCanFinish = new Promise<void>((resolve) => {
      finishLogin = resolve;
    });
    const action = vi.fn(async (formData: FormData) => {
      expect(lockHeld).toBe(true);
      expect(formData.get("email")).toBe("family@example.test");
      await loginCanFinish;
      expect(lockHeld).toBe(true);
    });
    render(<LoginForm action={action} />);

    await fillAndSubmit();
    fireEvent.submit(screen.getByRole("button").closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(lockHeld).toBe(true);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByLabelText("メールアドレス")).toBeDisabled();
    expect(screen.getByLabelText("パスワード")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "ログインを確認しています。",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button").closest("form")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    finishLogin();
    await waitFor(() => expect(lockHeld).toBe(false));
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
    expect(action).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "homerelay:auth-session",
      expect.objectContaining({
        mode: "exclusive",
        signal: expect.any(AbortSignal),
      }),
      expect.any(Function),
    );
  });

  it("shows a fixed safe alert and restores controls after action failure", async () => {
    const rawFailure = "provider-secret-error-detail";
    const request = vi.fn(
      async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => callback({ name, mode: "exclusive" } as Lock),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const action = vi.fn().mockRejectedValue(new Error(rawFailure));
    render(<LoginForm action={action} />);

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ログインを完了できませんでした。もう一度お試しください。",
    );
    expect(screen.queryByText(rawFailure)).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
    expect(screen.getByLabelText("メールアドレス")).toBeEnabled();
    expect(screen.getByLabelText("パスワード")).toBeEnabled();
    expect(screen.getByRole("button").closest("form")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  it("shows the same safe alert when lock acquisition is rejected", async () => {
    const request = vi.fn().mockRejectedValue(new Error("raw-lock-error"));
    vi.stubGlobal("navigator", { locks: { request } });
    const action = vi.fn();
    render(<LoginForm action={action} />);

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ログインを完了できませんでした。もう一度お試しください。",
    );
    expect(screen.queryByText("raw-lock-error")).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("fails closed without a native action when Web Locks are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const action = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm action={action} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "このブラウザでは安全なログインを開始できません。最新版のSafariまたはChromeで開いてください。",
    );
    const button = screen.getByRole("button", { name: "ログイン" });
    const form = button.closest("form");
    expect(button).toBeDisabled();
    expect(screen.getByLabelText("メールアドレス")).toBeDisabled();
    expect(screen.getByLabelText("パスワード")).toBeDisabled();
    expect(form).not.toHaveAttribute("action");
    fireEvent.submit(form!);
    expect(action).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<LoginForm action={action} />)).toContain(
      "JavaScriptを有効にし",
    );
  });

  it("times out only while waiting for the shared auth lock", async () => {
    vi.useFakeTimers();
    const request = vi.fn(
      (_name: string, options: LockOptions) =>
        new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const action = vi.fn();
    render(<LoginForm action={action} />);

    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled();
    submitFilledForm();
    await vi.advanceTimersByTimeAsync(5_000);

    await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "ログインを完了できませんでした。もう一度お試しください。",
    ));
    expect(action).not.toHaveBeenCalled();
  });
});
