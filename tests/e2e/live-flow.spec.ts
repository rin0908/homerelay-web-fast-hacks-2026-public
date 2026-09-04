import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  isPlaywrightLiveE2EEnabled,
  shouldRunPlaywrightLiveE2EProject,
} from "../../scripts/playwright-live-e2e.mjs";

const LIVE_ENABLED = isPlaywrightLiveE2EEnabled();
const LIVE_PASSWORD = process.env.HOMERELAY_E2E_PASSWORD?.trim() ?? "";
const LIVE_SUPABASE_SECRET_KEY =
  process.env.HOMERELAY_E2E_SUPABASE_SECRET_KEY?.trim() ?? "";
const LIVE_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const LIVE_BASE_URL = "http://127.0.0.1:3101";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PHOTO_BUCKET = "handoff-photos";
const SYNTHETIC_HELPER_HOUSEHOLD_ID = "a0000000-0000-4000-8000-000000000001";
const SYNTHETIC_FAMILY_MEMBER_ID = "a1000000-0000-4000-8000-000000000001";
const SYNTHETIC_HELPER_MEMBER_ID = "a1000000-0000-4000-8000-000000000002";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function createLiveAdminClient(secretKey: string) {
  return createClient(LIVE_SUPABASE_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

type LiveAdminClient = ReturnType<typeof createLiveAdminClient>;

let liveAdmin: LiveAdminClient | null = null;
const liveEntryMarkers = new Set<string>();

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

async function provisionSyntheticLiveUsers(): Promise<LiveAdminClient> {
  const { password, secretKey } = requireLoopbackProvisioningConfig();
  const admin = createLiveAdminClient(secretKey);

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

  return admin;
}

function isExpectedLivePhotoPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  const file = parts[2]?.match(/^([^.]+)\.(jpe?g|png|webp)$/i);
  return (
    parts.length === 3 &&
    parts[0] === SYNTHETIC_HELPER_HOUSEHOLD_ID &&
    parts[1] === SYNTHETIC_HELPER_MEMBER_ID &&
    file !== undefined &&
    file !== null &&
    UUID_PATTERN.test(file[1])
  );
}

async function cleanupSyntheticLiveEntries(
  admin: LiveAdminClient,
): Promise<void> {
  const markers = [...liveEntryMarkers];
  if (markers.length === 0) return;

  const { data: entries, error: lookupError } = await admin
    .from("entries")
    .select("id, author_member_id, household_id, photo_path, condition_summary")
    .in("condition_summary", markers);
  if (lookupError || !Array.isArray(entries)) {
    throw new Error("live_e2e_cleanup_entry_lookup_failed");
  }

  const markerSet = new Set(markers);
  const safeEntries = entries.every(
    (entry) =>
      typeof entry.id === "string" &&
      UUID_PATTERN.test(entry.id) &&
      entry.author_member_id === SYNTHETIC_HELPER_MEMBER_ID &&
      entry.household_id === SYNTHETIC_HELPER_HOUSEHOLD_ID &&
      typeof entry.condition_summary === "string" &&
      markerSet.has(entry.condition_summary) &&
      isExpectedLivePhotoPath(entry.photo_path),
  );
  if (!safeEntries) {
    throw new Error("live_e2e_cleanup_scope_rejected");
  }

  const entryIds = entries.map((entry) => entry.id);
  const photoPaths = entries.map((entry) => entry.photo_path);

  if (photoPaths.length > 0) {
    const { error: storageDeleteError } = await admin.storage
      .from(PHOTO_BUCKET)
      .remove(photoPaths);
    if (storageDeleteError) {
      throw new Error("live_e2e_cleanup_storage_delete_failed");
    }
  }

  if (entryIds.length > 0) {
    const { error: entryDeleteError } = await admin
      .from("entries")
      .delete()
      .in("id", entryIds)
      .in("condition_summary", markers)
      .eq("author_member_id", SYNTHETIC_HELPER_MEMBER_ID)
      .eq("household_id", SYNTHETIC_HELPER_HOUSEHOLD_ID);
    if (entryDeleteError) {
      throw new Error("live_e2e_cleanup_entry_delete_failed");
    }
  }

  const { data: entryReadBack, error: entryReadBackError } = await admin
    .from("entries")
    .select("id")
    .in("condition_summary", markers);
  if (entryReadBackError || (entryReadBack?.length ?? 0) !== 0) {
    throw new Error("live_e2e_cleanup_entries_not_zero");
  }

  if (entryIds.length > 0) {
    const [itemReadBack, acknowledgementReadBack] = await Promise.all([
      admin.from("needed_items").select("id").in("entry_id", entryIds),
      admin.from("acknowledgements").select("id").in("entry_id", entryIds),
    ]);
    if (
      itemReadBack.error ||
      acknowledgementReadBack.error ||
      (itemReadBack.data?.length ?? 0) !== 0 ||
      (acknowledgementReadBack.data?.length ?? 0) !== 0
    ) {
      throw new Error("live_e2e_cleanup_children_not_zero");
    }
  }

  for (const photoPath of photoPaths) {
    const separator = photoPath.lastIndexOf("/");
    const folder = photoPath.slice(0, separator);
    const fileName = photoPath.slice(separator + 1);
    const { data: objects, error: listError } = await admin.storage
      .from(PHOTO_BUCKET)
      .list(folder, { limit: 100, search: fileName });
    if (
      listError ||
      (objects ?? []).some((object) => object.name === fileName)
    ) {
      throw new Error("live_e2e_cleanup_storage_not_zero");
    }
  }
}

async function assertSyntheticLiveEntryCompleted(
  admin: LiveAdminClient,
  entryId: string,
  marker: string,
  neededItemName: string,
): Promise<void> {
  const [entryResult, itemResult, acknowledgementResult] = await Promise.all([
    admin
      .from("entries")
      .select(
        "id, author_member_id, household_id, condition_summary, status, claimed_by_member_id",
      )
      .eq("id", entryId)
      .maybeSingle(),
    admin
      .from("needed_items")
      .select(
        "id, entry_id, household_id, name, status, claimed_by_member_id, purchased_at",
      )
      .eq("entry_id", entryId),
    admin
      .from("acknowledgements")
      .select("entry_id, household_id, member_id, action")
      .eq("entry_id", entryId),
  ]);

  if (
    entryResult.error ||
    itemResult.error ||
    acknowledgementResult.error
  ) {
    throw new Error("live_e2e_completion_readback_failed");
  }

  const entry = entryResult.data;
  if (
    !entry ||
    entry.id !== entryId ||
    entry.author_member_id !== SYNTHETIC_HELPER_MEMBER_ID ||
    entry.household_id !== SYNTHETIC_HELPER_HOUSEHOLD_ID ||
    entry.condition_summary !== marker ||
    entry.status !== "done" ||
    entry.claimed_by_member_id !== SYNTHETIC_FAMILY_MEMBER_ID
  ) {
    throw new Error("live_e2e_entry_not_completed");
  }

  const items = itemResult.data ?? [];
  const item = items[0];
  if (
    items.length !== 1 ||
    !item ||
    !UUID_PATTERN.test(item.id) ||
    item.entry_id !== entryId ||
    item.household_id !== SYNTHETIC_HELPER_HOUSEHOLD_ID ||
    item.name !== neededItemName ||
    item.status !== "purchased" ||
    item.claimed_by_member_id !== SYNTHETIC_FAMILY_MEMBER_ID ||
    typeof item.purchased_at !== "string"
  ) {
    throw new Error("live_e2e_item_not_purchased");
  }

  const acknowledgements = acknowledgementResult.data ?? [];
  const actions = new Set(acknowledgements.map(({ action }) => action));
  if (
    acknowledgements.length !== 3 ||
    actions.size !== 3 ||
    !["confirmed", "claimed", "done"].every((action) => actions.has(action)) ||
    !acknowledgements.every(
      (acknowledgement) =>
        acknowledgement.entry_id === entryId &&
        acknowledgement.household_id === SYNTHETIC_HELPER_HOUSEHOLD_ID &&
        acknowledgement.member_id === SYNTHETIC_FAMILY_MEMBER_ID,
    )
  ) {
    throw new Error("live_e2e_acknowledgements_incomplete");
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

async function shareConfirmedHandoff(
  recordPage: Page,
  marker: string,
  neededItemName: string,
): Promise<string> {
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
  await recordPage.getByRole("textbox", { name: "必要なもの" }).fill(neededItemName);
  await recordPage.getByRole("button", { name: "これでOK" }).click();
  const publishResponse = recordPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/entries" &&
      response.request().method() === "POST",
  );
  await recordPage.getByRole("button", { name: "次の人へ" }).click();
  const response = await publishResponse;
  expect([200, 201]).toContain(response.status());
  const body: unknown = await response.json();
  const entryId =
    body && typeof body === "object" && "entryId" in body
      ? (body as { entryId: unknown }).entryId
      : null;
  if (typeof entryId !== "string" || !UUID_PATTERN.test(entryId)) {
    throw new Error("live_e2e_share_entry_id_invalid");
  }
  await expect(recordPage.getByRole("heading", { name: "家族画面へ共有しました" })).toBeVisible();
  return entryId;
}

test.describe("HomeRelay live Supabase flow", () => {
  test.skip(!LIVE_ENABLED, "HomeRelay local live credentials are not enabled");

  test.beforeAll(async ({}, testInfo) => {
    if (!shouldRunPlaywrightLiveE2EProject(LIVE_ENABLED, testInfo.project.name)) {
      return;
    }
    liveAdmin = await provisionSyntheticLiveUsers();
  });

  test.afterAll(async () => {
    const admin = liveAdmin;
    liveAdmin = null;
    if (!admin) return;
    await cleanupSyntheticLiveEntries(admin);
  });

  test("phone helper to separate desktop family succeeds twice", async ({ browser }, testInfo) => {
    test.skip(
      !shouldRunPlaywrightLiveE2EProject(LIVE_ENABLED, testInfo.project.name),
      "single cross-device project",
    );
    test.setTimeout(180_000);
    const admin = liveAdmin;
    if (!admin) {
      throw new Error("live_e2e_admin_unavailable");
    }

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

    // This suite verifies Supabase only; OpenAI has a separate billable live verifier.
    await helperContext.route("**/api/draft", (route) =>
      route.fulfill({
        body: JSON.stringify({
          mode: "demo",
          draft: {
            conditionSummary: "合成E2E下書き",
            completedSummary: "合成E2Eで水分を用意しました",
            nextRequest: "次の方もご確認ください",
            neededItems: ["合成E2Eティッシュ"],
          },
        }),
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        status: 200,
      }),
    );

    try {
      const familyPage = await login(familyContext, "family-a@homerelay.test");
      const helperPage = await login(helperContext, "helper-a@homerelay.test");

      for (let run = 1; run <= 2; run += 1) {
        const marker = `合成ライブデモ-${randomUUID()}-${run}`;
        const neededItemName = `${marker} ティッシュ`;
        liveEntryMarkers.add(marker);
        const startedAt = Date.now();
        const entryId = await shareConfirmedHandoff(
          helperPage,
          marker,
          neededItemName,
        );

        const sharedEntry = familyPage.locator("article").filter({ hasText: marker }).first();
        await expect(sharedEntry).toBeVisible({ timeout: 15_000 });
        const actionResponse = familyPage.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/actions" &&
            response.request().method() === "POST",
        );
        await sharedEntry.getByRole("button", { name: "見ました" }).click();
        await sharedEntry.getByRole("button", { name: "私がやります" }).click();
        await sharedEntry.getByRole("button", { name: "できました" }).click();
        await expect(sharedEntry.getByRole("button", { name: "できました" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        await sharedEntry.getByRole("button", { name: "買います" }).click();
        const purchased = sharedEntry.getByRole("button", { name: "買いました" });
        await purchased.click();
        await expect(purchased).toBeDisabled();
        expect((await actionResponse).status()).toBe(204);
        await expect(
          familyPage.getByText("タップを受け付けました。安全に反映しています…"),
        ).toHaveCount(0);
        await assertSyntheticLiveEntryCompleted(
          admin,
          entryId,
          marker,
          neededItemName,
        );
        expect(Date.now() - startedAt).toBeLessThan(60_000);
      }
    } finally {
      await helperContext.close();
      await familyContext.close();
    }
  });
});
