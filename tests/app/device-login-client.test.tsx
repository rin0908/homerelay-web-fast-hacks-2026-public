import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("DeviceLoginClient", () => {
  it("wires same-origin begin and exact completion around device transfer", async () => {
    window.history.replaceState(
      null,
      "",
      "/login/device/#token_hash=synthetic&type=magiclink",
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const consumeDeviceMagicLink = vi.fn(
      async (factories: {
        completePersistentSession: (value: {
          authUserId: string;
          expectedRole: "helper";
        }) => Promise<boolean>;
        preparePersistentSession: () => Promise<boolean>;
      }) => {
        expect(await factories.preparePersistentSession()).toBe(true);
        expect(
          await factories.completePersistentSession({
            authUserId: "synthetic-helper-user",
            expectedRole: "helper",
          }),
        ).toBe(true);
        return "invalid";
      },
    );
    vi.doMock("@/lib/supabase/client", () => ({
      createEphemeralClient: vi.fn(),
      createTransferClient: vi.fn(),
    }));
    vi.doMock("@/lib/supabase/device-login", () => ({
      consumeDeviceMagicLink,
    }));

    const { DeviceLoginClient } = await import(
      "@/app/login/device/DeviceLoginClient"
    );
    render(
      <DeviceLoginClient
        expectedRole="helper"
        heading="iPhoneの合成テストログイン"
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/login/device/session?phase=begin",
      { credentials: "same-origin", method: "POST" },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/login/device/session?phase=complete",
      {
        body: JSON.stringify({
          authUserId: "synthetic-helper-user",
          expectedRole: "helper",
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
  });

  it("preserves the current path, strips query credentials, and consumes the fragment once in Strict Mode", async () => {
    window.history.replaceState(
      null,
      "",
      "/login/device/family/?token_hash=query-secret&type=magiclink#token_hash=synthetic&type=magiclink",
    );

    const consumeDeviceMagicLink = vi.fn().mockResolvedValue("invalid");
    const createPersistentClient = vi.fn();
    const createVerificationClient = vi.fn();
    vi.doMock("@/lib/supabase/client", () => ({
      createEphemeralClient: createVerificationClient,
      createTransferClient: createPersistentClient,
    }));
    vi.doMock("@/lib/supabase/device-login", () => ({
      consumeDeviceMagicLink,
    }));

    const { DeviceLoginClient } = await import(
      "@/app/login/device/DeviceLoginClient"
    );
    render(
      <StrictMode>
        <DeviceLoginClient
          expectedRole="family"
          heading="Windowsの合成テストログイン"
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "この一度限りの認証は使用できません。再発行が必要です。",
        ),
      ).toBeInTheDocument();
    });
    expect(consumeDeviceMagicLink).toHaveBeenCalledOnce();
    expect(consumeDeviceMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        completePersistentSession: expect.any(Function),
        createPersistentClient,
        createVerificationClient,
        preparePersistentSession: expect.any(Function),
      }),
      "#token_hash=synthetic&type=magiclink",
      "family",
    );
    expect(createPersistentClient).not.toHaveBeenCalled();
    expect(createVerificationClient).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/login/device/family/");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("strips query credentials even when the one-time fragment is missing", async () => {
    window.history.replaceState(
      null,
      "",
      "/login/device/?token_hash=query-secret&type=magiclink",
    );

    const consumeDeviceMagicLink = vi.fn().mockResolvedValue("invalid");
    const createPersistentClient = vi.fn();
    const createVerificationClient = vi.fn();
    vi.doMock("@/lib/supabase/client", () => ({
      createEphemeralClient: createVerificationClient,
      createTransferClient: createPersistentClient,
    }));
    vi.doMock("@/lib/supabase/device-login", () => ({
      consumeDeviceMagicLink,
    }));

    const { DeviceLoginClient } = await import(
      "@/app/login/device/DeviceLoginClient"
    );
    render(
      <DeviceLoginClient
        expectedRole="helper"
        heading="iPhoneの合成テストログイン"
      />,
    );

    await waitFor(() => expect(consumeDeviceMagicLink).toHaveBeenCalledOnce());
    expect(consumeDeviceMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        completePersistentSession: expect.any(Function),
        createPersistentClient,
        createVerificationClient,
        preparePersistentSession: expect.any(Function),
      }),
      "",
      "helper",
    );
    expect(createPersistentClient).not.toHaveBeenCalled();
    expect(createVerificationClient).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/login/device/");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("shows a fixed unavailable message when authentication rejects", async () => {
    window.history.replaceState(
      null,
      "",
      "/login/device/helper/#token_hash=synthetic&type=magiclink",
    );

    const privateDetail = "private-provider-failure";
    vi.doMock("@/lib/supabase/client", () => ({
      createEphemeralClient: vi.fn(),
      createTransferClient: vi.fn(),
    }));
    vi.doMock("@/lib/supabase/device-login", () => ({
      consumeDeviceMagicLink: vi.fn().mockRejectedValue(new Error(privateDetail)),
    }));

    const { DeviceLoginClient } = await import(
      "@/app/login/device/DeviceLoginClient"
    );
    render(
      <DeviceLoginClient
        expectedRole="helper"
        heading="iPhoneの合成テストログイン"
      />,
    );

    expect(
      await screen.findByText(
        "現在ログインを確認できません。再発行してからお試しください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(privateDetail)).not.toBeInTheDocument();
  });
});
