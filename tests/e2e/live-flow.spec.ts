import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const LIVE_ENABLED = process.env.HOMERELAY_E2E_LIVE === "true";
const LOCAL_PASSWORD = "HomeRelayDemo2026!";
const LIVE_BASE_URL = "http://127.0.0.1:3101";

async function login(context: BrowserContext, email: string) {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(LOCAL_PASSWORD);
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
