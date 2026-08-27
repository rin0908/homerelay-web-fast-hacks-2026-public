import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const LIVE_ENABLED = process.env.HOMERELAY_E2E_LIVE === "true";
const LIVE_PASSWORD = process.env.HOMERELAY_E2E_PASSWORD?.trim() ?? "";
const LIVE_SUPABASE_SECRET_KEY =
  process.env.HOMERELAY_E2E_SUPABASE_SECRET_KEY?.trim() ?? "";
const LIVE_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const LIVE_BASE_URL = "http://127.0.0.1:3101";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SYNTHETIC_LIVE_USERS = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    email: "family-a@homerelay.test",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    email: "helper-a@homerelay.test",
  },
] as const;

function redactLiveError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [
    LIVE_PASSWORD,
    LIVE_SUPABASE_SECRET_KEY,
    LIVE_SUPABASE_URL,
  ]) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function requireLoopbackProvisioningConfig() {
  const missing = [
    ["HOMERELAY_E2E_PASSWORD", LIVE_PASSWORD],
    ["HOMERELAY_E2E_SUPABASE_SECRET_KEY", LIVE_SUPABASE_SECRET_KEY],
    ["NEXT_PUBLIC_SUPABASE_URL", LIVE_SUPABASE_URL],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Live E2E requires ${missing.join(", ")}`);
  }
  if (LIVE_PASSWORD.length < 12 || /[\r\n]/.test(LIVE_PASSWORD)) {
    throw new Error("HOMERELAY_E2E_PASSWORD must be at least 12 characters on one line");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(LIVE_SUPABASE_URL);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid loopback URL");
  }
  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    !LOOPBACK_HOSTS.has(parsedUrl.hostname)
  ) {
    throw new Error("Live E2E admin provisioning refuses non-loopback Supabase URLs");
  }

  return { password: LIVE_PASSWORD, secretKey: LIVE_SUPABASE_SECRET_KEY };
}

async function provisionSyntheticLiveUsers() {
  const { password, secretKey } = requireLoopbackProvisioningConfig();
  const admin = createClient(LIVE_SUPABASE_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  for (const account of SYNTHETIC_LIVE_USERS) {
    const { data: existing, error: lookupError } =
      await admin.auth.admin.getUserById(account.id);
    if (lookupError) {
      throw new Error(`Synthetic E2E user lookup failed: ${redactLiveError(lookupError)}`);
    }
    if (existing.user?.id !== account.id || existing.user.email !== account.email) {
      throw new Error("Fixed synthetic E2E user identity does not match the local seed");
    }

    const { data: updated, error: updateError } =
      await admin.auth.admin.updateUserById(account.id, { password });
    if (updateError) {
      throw new Error(`Synthetic E2E user provisioning failed: ${redactLiveError(updateError)}`);
    }
    if (updated.user?.id !== account.id) {
      throw new Error("Synthetic E2E password update targeted an unexpected user");
    }
  }
}

async function login(context: BrowserContext, email: string) {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(LIVE_PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "今日の様子", level: 1 })).toBeVisible();
  return page;
}

async function shareConfirmedHandoff(recordPage: Page, marker: string) {
  await recordPage.goto("/record");
  await recordPage.getByRole("button", { name: "写真を撮る" }).click();
  await expect(recordPage.getByLabel("カメラのプレビュー")).toBeVisible();
  await recordPage.getByRole("button", { name: "撮影" }).click();
  await recordPage.getByRole("button", { name: "この写真を使う" }).click();

  await recordPage.getByRole("button", { name: "声で話す" }).click();
  await expect(recordPage.getByText(/録音中/)).toBeVisible();
  await recordPage.waitForTimeout(700);
  await recordPage.getByRole("button", { name: "録音を停止" }).click();

  await expect(recordPage.getByRole("heading", { name: "AI下書きを確認" })).toBeVisible();
  await recordPage.getByRole("textbox", { name: "今日の様子" }).fill(marker);
  await recordPage.getByRole("textbox", { name: "必要なもの" }).fill(`${marker} ティッシュ`);
  await recordPage.getByRole("button", { name: "これでOK" }).click();
  await recordPage.getByRole("button", { name: "次の人へ" }).click();
  await expect(recordPage.getByRole("heading", { name: "家族画面へ共有しました" })).toBeVisible();
}

test.describe("HomeRelay live Supabase flow", () => {
  test.skip(!LIVE_ENABLED, "HomeRelay local live credentials are not enabled");

  test.beforeAll(async () => {
    if (!LIVE_ENABLED) return;
    await provisionSyntheticLiveUsers();
  });

  test("phone helper to separate desktop family succeeds twice", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "single cross-device project");
    test.setTimeout(180_000);

    const helperContext = await browser.newContext({
      baseURL: LIVE_BASE_URL,
      locale: "ja-JP",
      permissions: ["camera", "microphone"],
      viewport: { height: 844, width: 390 },
    });
    const familyContext = await browser.newContext({
      baseURL: LIVE_BASE_URL,
      locale: "ja-JP",
      viewport: { height: 900, width: 1280 },
    });

    try {
      const familyPage = await login(familyContext, "family-a@homerelay.test");
      const helperPage = await login(helperContext, "helper-a@homerelay.test");

      for (let run = 1; run <= 2; run += 1) {
        const marker = `合成ライブデモ${run}-${Date.now()}`;
        const startedAt = Date.now();
        await shareConfirmedHandoff(helperPage, marker);

        const sharedEntry = familyPage.locator("article").filter({ hasText: marker }).first();
        await expect(sharedEntry).toBeVisible({ timeout: 15_000 });
        await sharedEntry.getByRole("button", { name: "確認しました" }).click();
        await sharedEntry.getByRole("button", { name: "私が対応します" }).click();
        await sharedEntry.getByRole("button", { name: "対応しました" }).click();
        await expect(sharedEntry.getByRole("button", { name: "対応しました" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        await sharedEntry.getByRole("button", { name: "購入します" }).click();
        const purchased = sharedEntry.getByRole("button", { name: "購入しました" });
        await purchased.click();
        await expect(purchased).toBeDisabled();
        expect(Date.now() - startedAt).toBeLessThan(60_000);
      }
    } finally {
      await helperContext.close();
      await familyContext.close();
    }
  });
});
