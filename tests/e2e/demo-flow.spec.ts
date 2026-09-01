import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

test("写真と声の申し送りを家族へ共有し、購入完了まで引き継げる", async ({ context }) => {
  const externalRequests: string[] = [];
  const editedCondition = "編集済み：昼食後は穏やかに過ごされました";
  const neededItem = "合成デモ用ティッシュ";

  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";

    if ((url.protocol === "http:" || url.protocol === "https:") && !isLocal) {
      externalRequests.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });

  const familyPage = await context.newPage();
  await familyPage.goto("/");
  await familyPage.evaluate(() => window.localStorage.clear());
  await familyPage.reload();
  await expect(familyPage.getByRole("heading", { name: "今日の様子", level: 1 })).toBeVisible();
  // Wait for the client relay subscription, not only the server-rendered shell.
  await expect(
    familyPage.locator("article").filter({
      hasText: "昼食は半分ほど召し上がりました",
    }),
  ).toBeVisible({ timeout: 15_000 });

  const recordPage = await context.newPage();
  await recordPage.goto("/record");

  await recordPage.getByRole("button", { name: "写真を撮る" }).click();
  await expect(recordPage.getByLabel("カメラのプレビュー")).toBeVisible();
  await recordPage.getByRole("button", { name: "撮影" }).click();
  await expect(recordPage.getByAltText("撮影した写真の確認")).toBeVisible();
  await recordPage.getByRole("button", { name: "この写真を使う" }).click();

  await expect(recordPage.locator('[data-stage="voice"]')).toBeFocused();
  const startRecording = recordPage.getByRole("button", { name: "声で話す" });
  await expect(startRecording).toBeInViewport();
  await startRecording.click();
  await expect(recordPage.getByText(/録音中/)).toBeVisible();
  await recordPage.waitForTimeout(700);
  await recordPage.getByRole("button", { name: "録音を停止" }).click();

  await expect(
    recordPage.getByRole("heading", { name: "AI下書きを確認" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(recordPage.locator('[data-stage="confirm"]')).toBeFocused();
  await recordPage.getByRole("textbox", { name: "今日の様子" }).fill(editedCondition);
  await recordPage.getByRole("textbox", { name: "必要なもの" }).fill(neededItem);
  const confirm = recordPage.getByRole("button", { name: "これでOK" });
  await expect(confirm).toBeInViewport();
  await confirm.click();

  await expect(recordPage.getByRole("heading", { name: "共有する内容が整いました" })).toBeVisible();
  await expect(recordPage.locator('[data-stage="share"]')).toBeFocused();
  await expect(recordPage.getByText(editedCondition)).toBeVisible();
  const share = recordPage.getByRole("button", { name: "次の人へ" });
  await expect(share).toBeInViewport();
  await share.click();
  await expect(recordPage.getByRole("heading", { name: "家族画面へ共有しました" })).toBeVisible();

  const sharedEntry = familyPage.locator("article").filter({ hasText: editedCondition }).first();
  await expect(sharedEntry).toBeVisible({ timeout: 10_000 });
  await expect(sharedEntry.getByText(editedCondition)).toBeVisible();
  await expect(sharedEntry.getByText(neededItem)).toBeVisible();

  const acknowledged = sharedEntry.getByRole("button", { name: "見ました" });
  await expect(acknowledged).toBeEnabled();
  await acknowledged.click();
  await expect(acknowledged).toHaveAttribute("aria-pressed", "true");

  const claimed = sharedEntry.getByRole("button", { name: "私がやります" });
  await expect(claimed).toBeEnabled();
  await claimed.click();
  await expect(claimed).toHaveAttribute("aria-pressed", "true");

  const completed = sharedEntry.getByRole("button", { name: "できました" });
  await expect(completed).toBeEnabled();
  await completed.click();
  await expect(completed).toHaveAttribute("aria-pressed", "true");

  const purchaseIntent = sharedEntry.getByRole("button", { name: "買います" });
  await expect(purchaseIntent).toBeEnabled();
  await purchaseIntent.click();

  const purchased = sharedEntry.getByRole("button", { name: "買いました" });
  await expect(purchased).toBeEnabled();
  await purchased.click();
  await expect(purchased).toBeDisabled();

  expect(externalRequests).toEqual([]);
});
