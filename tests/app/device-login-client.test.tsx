import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("DeviceLoginClient", () => {
  it("preserves the current path and consumes the fragment once in Strict Mode", async () => {
    window.history.replaceState(
      null,
      "",
      "/login/device/family/?source=qr#token_hash=synthetic&type=magiclink",
    );

    const consumeDeviceMagicLink = vi.fn().mockResolvedValue("invalid");
    const supabase = { synthetic: true };
    vi.doMock("@/lib/supabase/client", () => ({
      createClient: () => supabase,
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
      supabase,
      "#token_hash=synthetic&type=magiclink",
      "family",
    );
    expect(window.location.pathname).toBe("/login/device/family/");
    expect(window.location.search).toBe("?source=qr");
    expect(window.location.hash).toBe("");
  });
});
