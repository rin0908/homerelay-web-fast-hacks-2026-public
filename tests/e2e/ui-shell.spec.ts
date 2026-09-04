import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

const EXPECTED_SECURITY_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "camera=(self), microphone=(self), geolocation=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const accessibility = await new AxeBuilder({ page }).analyze();
  const serious = accessibility.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious).toEqual([]);
}

function isMobileViewport(page: Page): boolean {
  const viewport = page.viewportSize();
  return viewport !== null && viewport.width < 1024;
}

test("serves security headers without framework disclosure", async ({ request }) => {
  for (const route of ["/", "/record", "/api/status"]) {
    const response = await request.get(route);
    expect(response.ok(), `${route} should return a successful response`).toBe(true);
    const headers = response.headers();

    expect(headers).toMatchObject(EXPECTED_SECURITY_HEADERS);
    const contentSecurityPolicy = headers["content-security-policy"];
    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("base-uri 'self'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("form-action 'self'");
    expect(headers["x-powered-by"]).toBeUndefined();
  }
});

test("warm home shell is complete and responsive", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/HomeRelay/);
  await expect(page.getByRole("heading", { name: "今日の様子", level: 1 })).toBeVisible();
  const visibleCameraLink = isMobileViewport(page)
    ? page.getByTestId("mobile-record-cta")
    : page.getByRole("link", { name: "カメラを開く", exact: true });
  await expect(visibleCameraLink).toBeVisible();
  await expect(page.getByText("ご家族", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("ご親族", { exact: true })).toBeVisible();
  await expect(page.getByText("訪問ヘルパー", { exact: true }).first()).toBeVisible();
  await expect(page.getByAltText("合成デモ用の、半分ほど食べた昼食")).toBeVisible();
  await expect(page.getByText("合成デモモード")).toBeVisible();
  await expect(page.getByText("合成候補（Qdrant未接続）")).toBeVisible();

  const mobileRecordCta = page.getByTestId("mobile-record-cta");
  if (isMobileViewport(page)) {
    await expect(mobileRecordCta).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(mobileRecordCta).toBeVisible();
    const ctaBox = await mobileRecordCta.boundingBox();
    expect(ctaBox).not.toBeNull();
    expect((ctaBox?.y ?? 0) + (ctaBox?.height ?? 0)).toBeLessThanOrEqual(
      page.viewportSize()?.height ?? 0,
    );
  } else {
    await expect(mobileRecordCta).toBeHidden();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await page.locator("[data-nextjs-dialog]").count()).toBe(0);

  await expectNoSeriousAccessibilityViolations(page);

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`home-${testInfo.project.name}.png`),
  });
});

test("home camera CTA starts the in-page camera without a duplicate start tap", async ({ page }) => {
  await page.goto("/");
  const cameraLink = isMobileViewport(page)
    ? page.getByTestId("mobile-record-cta")
    : page.getByRole("link", { name: "カメラを開く", exact: true });

  await expect(cameraLink).toHaveAttribute("href", "/record?camera=1");
  await cameraLink.click();

  await expect(page).toHaveURL(/\/record\?camera=1$/, { timeout: 15_000 });
  await expect(page.getByLabel("カメラのプレビュー")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "撮影" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "写真を撮る" })).toHaveCount(0);
});

test("record shell shows the four short steps", async ({ page }, testInfo) => {
  await page.goto("/record");
  await expect(page.getByRole("heading", { name: "写真と声で記録", level: 1 })).toBeVisible();
  for (const label of ["写真を撮る", "話す", "これでOK", "次の人へ"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("確認するまで、ほかの人には共有されません。")).toBeVisible();
  expect(await page.locator("[data-nextjs-dialog]").count()).toBe(0);

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();

  await expectNoSeriousAccessibilityViolations(page);

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`record-${testInfo.project.name}.png`),
  });
});

test("camera capture stays in-page through retake and accept", async ({ page }, testInfo) => {
  await page.goto("/record");

  await page.getByRole("button", { name: "写真を撮る" }).click();
  await expect(page.getByLabel("カメラのプレビュー")).toBeVisible();
  await expect(page.getByRole("button", { name: "撮影" })).toBeVisible();

  await page.getByRole("button", { name: "撮影" }).click();
  await expect(page.getByAltText("撮影した写真の確認")).toBeVisible();
  await page.getByRole("button", { name: "撮り直す" }).click();
  await expect(page.getByLabel("カメラのプレビュー")).toBeVisible();

  await page.getByRole("button", { name: "撮影" }).click();
  await page.getByRole("button", { name: "この写真を使う" }).click();
  await expect(page.getByRole("heading", { name: "写真を選びました" })).toBeVisible();
  await expect(page.getByRole("button", { name: "声で話す" })).toBeEnabled();

  expect(await page.locator("input[type=file]").count()).toBe(0);
  expect(await page.locator("[data-nextjs-dialog]").count()).toBe(0);
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`camera-accepted-${testInfo.project.name}.png`),
  });
});

test("voice becomes an editable draft and stays private until confirmation", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/record");

  await page.getByRole("button", { name: "写真を撮る" }).click();
  await page.getByRole("button", { name: "撮影" }).click();
  await page.getByRole("button", { name: "この写真を使う" }).click();

  await page.getByRole("button", { name: "声で話す" }).click();
  await expect(page.getByText(/録音中/)).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "録音を停止" }).click();

  await expect(page.getByRole("heading", { name: "AI下書きを確認" })).toBeVisible();
  await expect(page.getByText("合成AI下書き（OpenAI未接続）です。自由に編集できます。")).toBeVisible();
  await expect(page.getByText("まだ家族には共有されていません")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  const condition = page.getByRole("textbox", { name: "今日の様子" });
  await condition.fill("昼食は半分ほど召し上がりました（本人確認）");
  await page.getByRole("button", { name: "これでOK" }).click();

  await expect(page.getByRole("heading", { name: "共有する内容が整いました" })).toBeVisible();
  await expect(page.getByText("昼食は半分ほど召し上がりました（本人確認）")).toBeVisible();
  await expect(page.getByRole("button", { name: "次の人へ" })).toBeEnabled();
  expect(requests.some((url) => url.includes("/api/entries"))).toBe(false);
});

test("AI failure switches to empty manual input without sharing", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/api/draft", (route) =>
    route.fulfill({
      body: JSON.stringify({ error: "AIの下書きを作れませんでした" }),
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      status: 502,
    }),
  );
  await page.goto("/record");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: "写真を撮る" }).click();
  await page.getByRole("button", { name: "撮影" }).click();
  await page.getByRole("button", { name: "この写真を使う" }).click();
  await page.getByRole("button", { name: "声で話す" }).click();
  await expect(page.getByText(/録音中/)).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "録音を停止" }).click();

  await expect(
    page.getByText("AIの下書きを作れませんでした", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "手入力する" }).click();

  await expect(
    page.getByRole("heading", { name: "手入力で申し送りを作成" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "今日の様子" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "必要なもの" })).toHaveValue("");
  expect(requests.some((url) => url.includes("/api/entries"))).toBe(false);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("homerelay:demo:entries:v1"),
    ),
  ).toBeNull();

  const manualSummary = "合成テスト：昼食後は穏やかでした";
  await page.getByRole("textbox", { name: "今日の様子" }).fill(manualSummary);
  await page.getByRole("button", { name: "これでOK" }).click();

  await expect(
    page.getByRole("heading", { name: "共有する内容が整いました" }),
  ).toBeVisible();
  expect(requests.some((url) => url.includes("/api/entries"))).toBe(false);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("homerelay:demo:entries:v1"),
    ),
  ).toBeNull();

  await page.getByRole("button", { name: "次の人へ" }).click();
  await expect(
    page.getByRole("heading", { name: "家族画面へ共有しました" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("homerelay:demo:entries:v1"),
    ),
  ).not.toBeNull();
  await page.goto("/");
  await expect(page.getByText(manualSummary)).toBeVisible();
});
