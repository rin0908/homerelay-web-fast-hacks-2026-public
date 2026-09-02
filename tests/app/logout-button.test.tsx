import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

import { LogoutButton } from "@/app/logout/LogoutButton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.createClient.mockReturnValue({ auth: { signOut: mocks.signOut } });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
});

function installImmediateLock() {
  let lockHeld = false;
  const request = vi.fn(
    async (
      name: string,
      _options: LockOptions,
      callback: (lock: Lock | null) => unknown,
    ) => {
      lockHeld = true;
      try {
        return await callback({ name, mode: "exclusive" } as Lock);
      } finally {
        lockHeld = false;
      }
    },
  );
  vi.stubGlobal("navigator", { locks: { request } });
  return { isHeld: () => lockHeld, request };
}

async function readyLogoutButton() {
  const button = screen.getByRole("button", { name: "ログアウト" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe("LogoutButton", () => {
  it("holds the shared lock through the server POST and blocks a double click", async () => {
    const lock = installImmediateLock();
    let finishRequest!: () => void;
    const requestCanFinish = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    vi.mocked(fetch).mockImplementation(async () => {
      expect(lock.isHeld()).toBe(true);
      await requestCanFinish;
      expect(lock.isHeld()).toBe(true);
      return new Response(null, { status: 204 });
    });
    render(<LogoutButton />);

    const button = await readyLogoutButton();
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    expect(button.closest("form")).toHaveAttribute("aria-busy", "true");
    expect(lock.request).toHaveBeenCalledWith(
      "homerelay:auth-session",
      { mode: "exclusive", signal: expect.any(AbortSignal) },
      expect.any(Function),
    );

    finishRequest();
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith("/logout", {
      credentials: "same-origin",
      headers: { "X-HomeRelay-Logout": "fetch" },
      method: "POST",
    });
  });

  it("does not depend on browser signOut after the server committed logout", async () => {
    installImmediateLock();
    mocks.signOut.mockRejectedValue(new Error("synthetic client failure"));
    render(<LogoutButton />);

    fireEvent.click(await readyLogoutButton());

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not let a stalled local sign-out notification block navigation", async () => {
    vi.useFakeTimers();
    const lock = installImmediateLock();
    mocks.signOut.mockReturnValue(new Promise(() => {}));
    render(<LogoutButton />);

    await act(async () => vi.advanceTimersByTimeAsync(0));
    const button = screen.getByRole("button", { name: "ログアウト" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await vi.advanceTimersByTimeAsync(750);

    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(lock.isHeld()).toBe(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a fixed failure when the server does not commit signed-out", async () => {
    installImmediateLock();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    render(<LogoutButton />);

    fireEvent.click(await readyLogoutButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ログアウトを完了できませんでした。もう一度お試しください。",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("fails closed without a native POST when Web Locks are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    render(<LogoutButton />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "このブラウザでは安全なログアウトを開始できません。最新版のSafariまたはChromeで開いてください。",
    );
    const button = screen.getByRole("button", { name: "ログアウト" });
    const form = button.closest("form");
    expect(button).toBeDisabled();
    expect(form).not.toHaveAttribute("action");
    expect(form).not.toHaveAttribute("method");
    fireEvent.submit(form!);

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<LogoutButton />)).toContain(
      "JavaScriptを有効にし",
    );
  });

  it("bounds lock acquisition and never starts a late logout", async () => {
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
    render(<LogoutButton />);

    await act(async () => vi.advanceTimersByTimeAsync(0));
    const button = screen.getByRole("button", { name: "ログアウト" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await vi.advanceTimersByTimeAsync(5_000);

    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "ログアウトを完了できませんでした。もう一度お試しください。",
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
