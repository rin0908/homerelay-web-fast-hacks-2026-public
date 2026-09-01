import { Buffer } from "node:buffer";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_HOST_PATTERN =
  /^homerelay-web-fast-hacks-2026(?:-[a-z0-9-]+)?\.vercel\.app$/i;
const FIXTURE_LEDGER_PATH = path.resolve(
  process.cwd(),
  ".vercel",
  "homerelay-hosted-fixture.json",
);
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION?.trim() || "homerelay_entries";

type FixtureLedger = Readonly<{
  projectRef: string;
  state: string;
  fixture: Readonly<{
    family: Readonly<{ householdId: string }>;
    foreignFamily: Readonly<{ householdId: string }>;
    helper: Readonly<{ householdId: string }>;
  }>;
}>;

type HostedConfiguration = Readonly<{
  accessUrl: string | null;
  familyPassword: string;
  foreignFamilyPassword: string;
  helperPassword: string;
  neo4jEndpoint: string;
  neo4jPassword: string;
  neo4jUsername: string;
  previewOrigin: string;
  qdrantApiKey: string;
  qdrantOrigin: string;
}>;

function fail(code: string): never {
  throw new Error(`Hosted E2E refused: ${code}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name}_required`);
  return value;
}

function parsePreviewOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("preview_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    !PREVIEW_HOST_PATTERN.test(url.hostname)
  ) {
    return fail("preview_url_not_allowlisted");
  }
  return url;
}

function parseAccessUrl(value: string | undefined, previewOrigin: string): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return fail("preview_access_url_invalid");
  }
  const keys = [...url.searchParams.keys()];
  if (
    url.origin !== previewOrigin ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    keys.length !== 1 ||
    keys[0] !== "_vercel_share" ||
    !url.searchParams.get("_vercel_share")
  ) {
    return fail("preview_access_url_refused");
  }
  return url.toString();
}

function strongPassword(name: string): string {
  const value = requiredEnvironment(name);
  if (
    value.length < 32 ||
    value.length > 256 ||
    /[\r\n\u0000]/.test(value) ||
    !/[a-z]/.test(value) ||
    !/[A-Z]/.test(value) ||
    !/\d/.test(value) ||
    !/[^A-Za-z0-9]/.test(value)
  ) {
    return fail(`${name}_not_strong`);
  }
  return value;
}

function parseHttpsOrigin(value: string, code: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(`${code}_invalid`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    return fail(`${code}_unsafe`);
  }
  return url;
}

function neo4jEndpoint(): string {
  const uri = parseHttpsOrigin(
    requiredEnvironment("NEO4J_URI").replace(/^neo4j\+s:/i, "https:"),
    "neo4j_uri",
  );
  const username = requiredEnvironment("NEO4J_USERNAME");
  const explicitDatabase = process.env.NEO4J_DATABASE?.trim();
  const hostPrefix = /^([a-z0-9]{8})\.databases\.neo4j\.io$/i.exec(uri.hostname)?.[1];
  const database =
    explicitDatabase ||
    (hostPrefix?.toLowerCase() === username.toLowerCase() ? username : "neo4j");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(database)) {
    return fail("neo4j_database_invalid");
  }
  return `${uri.origin}/db/${encodeURIComponent(database)}/query/v2`;
}

function loadConfiguration(): HostedConfiguration {
  if (process.env.HOMERELAY_HOSTED_E2E?.trim().toLowerCase() !== "true") {
    fail("explicit_opt_in_required");
  }
  const previewOrigin = parsePreviewOrigin(
    requiredEnvironment("HOMERELAY_PREVIEW_URL"),
  ).origin;
  const qdrant = parseHttpsOrigin(
    requiredEnvironment("QDRANT_URL"),
    "qdrant_url",
  );
  if (!qdrant.hostname.endsWith(".cloud.qdrant.io")) {
    fail("qdrant_host_not_allowlisted");
  }

  const configuration = {
    accessUrl: parseAccessUrl(
      process.env.HOMERELAY_PREVIEW_ACCESS_URL,
      previewOrigin,
    ),
    familyPassword: strongPassword("HOMERELAY_CLOUD_FAMILY_PASSWORD"),
    foreignFamilyPassword: strongPassword(
      "HOMERELAY_CLOUD_FOREIGN_FAMILY_PASSWORD",
    ),
    helperPassword: strongPassword("HOMERELAY_CLOUD_HELPER_PASSWORD"),
    neo4jEndpoint: neo4jEndpoint(),
    neo4jPassword: requiredEnvironment("NEO4J_PASSWORD"),
    neo4jUsername: requiredEnvironment("NEO4J_USERNAME"),
    previewOrigin,
    qdrantApiKey: requiredEnvironment("QDRANT_API_KEY"),
    qdrantOrigin: qdrant.origin,
  } satisfies HostedConfiguration;

  if (
    new Set([
      configuration.familyPassword,
      configuration.foreignFamilyPassword,
      configuration.helperPassword,
    ]).size !== 3
  ) {
    fail("fixture_passwords_must_be_distinct");
  }
  return configuration;
}

function loadFixtureLedger(): FixtureLedger {
  const status = lstatSync(FIXTURE_LEDGER_PATH);
  if (!status.isFile() || status.isSymbolicLink()) {
    return fail("fixture_ledger_path_refused");
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(FIXTURE_LEDGER_PATH, "utf8")) as unknown;
  } catch {
    return fail("fixture_ledger_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("fixture_ledger_invalid");
  }
  const ledger = value as FixtureLedger;
  const householdIds = [
    ledger.fixture?.family?.householdId,
    ledger.fixture?.helper?.householdId,
    ledger.fixture?.foreignFamily?.householdId,
  ];
  if (
    ledger.projectRef !== "czfmqaeqamepntpsakbv" ||
    ledger.state !== "ready" ||
    !householdIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id)) ||
    householdIds[0] !== householdIds[1] ||
    householdIds[0] === householdIds[2]
  ) {
    return fail("fixture_ledger_not_ready");
  }
  return ledger;
}

async function bootstrapPreviewAccess(
  context: BrowserContext,
  configuration: HostedConfiguration,
): Promise<void> {
  if (!configuration.accessUrl) return;
  const page = await context.newPage();
  try {
    await page.goto(configuration.accessUrl, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    if (new URL(page.url()).origin !== configuration.previewOrigin) {
      fail("preview_access_redirected_off_origin");
    }
  } catch {
    fail("preview_access_bootstrap_failed");
  } finally {
    await page.close();
  }
}

async function login(
  context: BrowserContext,
  configuration: HostedConfiguration,
  email: string,
  password: string,
): Promise<Page> {
  await bootstrapPreviewAccess(context, configuration);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "今日の様子" }),
  ).toBeVisible();
  return page;
}

async function publishConfirmedHandoff(
  helperPage: Page,
  familyPage: Page,
  foreignPage: Page,
  run: number,
): Promise<{ entryId: string; marker: string; purchaseItem: string }> {
  const marker = `架空HTTPS導線${run}-${Date.now()}`;
  const purchaseItem = `架空テスト購入品${run}`;

  await helperPage.goto("/record");
  await helperPage.getByRole("button", { name: "写真を撮る" }).click();
  await expect(helperPage.getByLabel("カメラのプレビュー")).toBeVisible();
  await helperPage.getByRole("button", { name: "撮影" }).click();
  await expect(helperPage.getByAltText("撮影した写真の確認")).toBeVisible();
  await helperPage.getByRole("button", { name: "この写真を使う" }).click();

  await helperPage.getByRole("button", { name: "声で話す" }).click();
  await expect(helperPage.getByText(/録音中/)).toBeVisible();
  await helperPage.waitForTimeout(1_500);
  await helperPage.getByRole("button", { name: "録音を停止" }).click();
  await expect(
    helperPage.getByRole("heading", { name: "AI下書きを確認" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    helperPage.getByText("OpenAIで整えた下書きです。必ず本人が確認します。"),
  ).toBeVisible();

  // The draft above came from the real Preview OpenAI route. The marker is
  // then edited by the synthetic user so the confirmation boundary is exact.
  await helperPage
    .getByRole("textbox", { name: "今日の様子" })
    .fill(`架空テスト：昼食後は穏やかに過ごしました。${marker}`);
  await helperPage
    .getByRole("textbox", { name: "今日できたこと" })
    .fill("架空テストで水分を用意しました");
  await helperPage
    .getByRole("textbox", { name: "次の方へのお願い" })
    .fill("次の方も架空テスト内容をご確認ください");
  await helperPage
    .getByRole("textbox", { name: "必要なもの" })
    .fill(`${purchaseItem}\n架空テスト共通未購入品`);

  await familyPage.waitForTimeout(750);
  await expect(familyPage.getByText(marker)).toHaveCount(0);
  await expect(foreignPage.getByText(marker)).toHaveCount(0);

  await helperPage.getByRole("button", { name: "これでOK" }).click();
  await expect(
    helperPage.getByRole("heading", { name: "共有する内容が整いました" }),
  ).toBeVisible();
  await expect(helperPage.getByText("まだ家族には共有されていません")).toBeVisible();
  await familyPage.waitForTimeout(750);
  await expect(familyPage.getByText(marker)).toHaveCount(0);
  await expect(foreignPage.getByText(marker)).toHaveCount(0);

  const publishResponse = helperPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/entries" &&
      response.request().method() === "POST",
  );
  await helperPage.getByRole("button", { name: "次の人へ" }).click();
  const response = await publishResponse;
  if (![200, 201].includes(response.status())) fail("share_request_failed");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fail("share_response_invalid");
  }
  const entryId =
    body && typeof body === "object" && "entryId" in body
      ? (body as { entryId: unknown }).entryId
      : null;
  if (typeof entryId !== "string" || !UUID_PATTERN.test(entryId)) {
    return fail("share_entry_id_invalid");
  }
  await expect(
    helperPage.getByRole("heading", { name: "家族画面へ共有しました" }),
  ).toBeVisible();
  return { entryId, marker, purchaseItem };
}

async function assertForeignHouseholdDenied(
  foreignPage: Page,
  entryId: string,
  marker: string,
): Promise<void> {
  await expect(foreignPage.getByText(marker)).toHaveCount(0);
  const result = await foreignPage.evaluate(async (foreignEntryId) => {
    const related = await fetch(
      `/api/entries/${encodeURIComponent(foreignEntryId)}/related`,
      { headers: { Accept: "application/json" } },
    );
    const action = await fetch("/api/actions", {
      body: JSON.stringify({
        action: "acknowledge_entry",
        targetId: foreignEntryId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return { actionStatus: action.status, relatedStatus: related.status };
  }, entryId);

  expect(result.relatedStatus).toBe(404);
  expect(result.actionStatus).toBeGreaterThanOrEqual(400);
  expect(result.actionStatus).toBeLessThan(500);
}

async function completeFamilyActions(
  familyPage: Page,
  marker: string,
  purchaseItem: string,
): Promise<void> {
  const sharedEntry = familyPage.locator("article.soft-card").filter({ hasText: marker }).first();
  await expect(sharedEntry).toBeVisible({ timeout: 20_000 });

  const acknowledged = sharedEntry.getByRole("button", { name: "見ました" });
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

  const neededItem = sharedEntry.locator("article").filter({ hasText: purchaseItem }).first();
  await neededItem.getByRole("button", { name: "買います" }).click();
  const purchased = neededItem.getByRole("button", { name: "買いました" });
  await expect(purchased).toBeEnabled();
  await purchased.click();
  await expect(purchased).toBeDisabled();
}

async function qdrantFixturePointCount(
  configuration: HostedConfiguration,
  householdId: string,
): Promise<number> {
  try {
    const response = await fetch(
      `${configuration.qdrantOrigin}/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/scroll`,
      {
        body: JSON.stringify({
          filter: {
            must: [{ key: "household_id", match: { value: householdId } }],
          },
          limit: 100,
          with_payload: ["entry_id", "household_id", "type"],
          with_vector: false,
        }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "api-key": configuration.qdrantApiKey,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) return fail("qdrant_readback_failed");
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("result" in value)) {
      return fail("qdrant_readback_invalid");
    }
    const result = (value as { result: unknown }).result;
    if (!result || typeof result !== "object" || !("points" in result)) {
      return fail("qdrant_readback_invalid");
    }
    const points = (result as { points: unknown }).points;
    if (!Array.isArray(points)) return fail("qdrant_readback_invalid");
    return points.length;
  } catch {
    return fail("qdrant_readback_failed");
  }
}

async function neo4jFixtureCounts(
  configuration: HostedConfiguration,
  householdId: string,
): Promise<{ nodes: number; relationships: number }> {
  const statement = "MATCH (n) WHERE (n:HomeRelayHousehold AND n.id = $householdId) OR (n:HomeRelayMember AND n.householdId = $householdId) OR (n:HomeRelayHandoff AND n.householdId = $householdId) OR (n:HomeRelayNeededItem AND n.householdId = $householdId) OR (n:HomeRelayItemConcept AND n.householdId = $householdId) WITH count(n) AS nodeCount OPTIONAL MATCH (source)-[relationship]->(target) WHERE (source.householdId = $householdId OR source.id = $householdId) AND (target.householdId = $householdId OR target.id = $householdId) RETURN nodeCount, count(DISTINCT relationship) AS relationshipCount";
  const authorization = Buffer.from(
    `${configuration.neo4jUsername}:${configuration.neo4jPassword}`,
    "utf8",
  ).toString("base64");
  try {
    const response = await fetch(configuration.neo4jEndpoint, {
      body: JSON.stringify({ parameters: { householdId }, statement }),
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return fail("neo4j_readback_failed");
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("data" in value)) {
      return fail("neo4j_readback_invalid");
    }
    const data = (value as { data: unknown }).data;
    if (!data || typeof data !== "object" || !("values" in data)) {
      return fail("neo4j_readback_invalid");
    }
    const values = (data as { values: unknown }).values;
    if (
      !Array.isArray(values) ||
      values.length !== 1 ||
      !Array.isArray(values[0]) ||
      values[0].length !== 2 ||
      !values[0].every((item) => typeof item === "number" && Number.isFinite(item))
    ) {
      return fail("neo4j_readback_invalid");
    }
    return { nodes: values[0][0], relationships: values[0][1] };
  } catch {
    return fail("neo4j_readback_failed");
  }
}

async function waitForVendorReadback(
  configuration: HostedConfiguration,
  ledger: FixtureLedger,
): Promise<void> {
  const primaryHouseholdId = ledger.fixture.family.householdId;
  const foreignHouseholdId = ledger.fixture.foreignFamily.householdId;
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const [qdrantPrimary, qdrantForeign, neo4jPrimary, neo4jForeign] =
      await Promise.all([
        qdrantFixturePointCount(configuration, primaryHouseholdId),
        qdrantFixturePointCount(configuration, foreignHouseholdId),
        neo4jFixtureCounts(configuration, primaryHouseholdId),
        neo4jFixtureCounts(configuration, foreignHouseholdId),
      ]);
    if (
      qdrantPrimary >= 2 &&
      qdrantForeign === 0 &&
      neo4jPrimary.nodes > 0 &&
      neo4jPrimary.relationships > 0 &&
      neo4jForeign.nodes === 0 &&
      neo4jForeign.relationships === 0
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  fail("vendor_runtime_readback_not_ready");
}

test("HTTPS Preview automated two-context flow succeeds twice with live services", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  test.info().annotations.push(
    {
      description:
        "Synthetic camera and synthetic audio fixtures; this is not physical-device evidence.",
      type: "media",
    },
    {
      description:
        "OpenAI, Supabase, Qdrant and Neo4j Preview runtime calls are not mocked.",
      type: "integration",
    },
  );

  const configuration = loadConfiguration();
  const ledger = loadFixtureLedger();
  const helperContext = await browser.newContext({
    baseURL: configuration.previewOrigin,
    locale: "ja-JP",
    permissions: ["camera", "microphone"],
    viewport: { height: 844, width: 390 },
  });
  const familyContext = await browser.newContext({
    baseURL: configuration.previewOrigin,
    locale: "ja-JP",
    viewport: { height: 900, width: 1280 },
  });
  const foreignContext = await browser.newContext({
    baseURL: configuration.previewOrigin,
    locale: "ja-JP",
    viewport: { height: 900, width: 1280 },
  });

  try {
    const familyPage = await login(
      familyContext,
      configuration,
      "family-a@homerelay.test",
      configuration.familyPassword,
    );
    const foreignPage = await login(
      foreignContext,
      configuration,
      "family-b@homerelay.test",
      configuration.foreignFamilyPassword,
    );
    const helperPage = await login(
      helperContext,
      configuration,
      "helper-a@homerelay.test",
      configuration.helperPassword,
    );
    let familyNavigations = 0;
    familyPage.on("framenavigated", (frame) => {
      if (frame === familyPage.mainFrame()) familyNavigations += 1;
    });
    const firstMarker = { value: "" };

    for (let run = 1; run <= 2; run += 1) {
      const navigationBaseline = familyNavigations;
      const startedAt = Date.now();
      const shared = await publishConfirmedHandoff(
        helperPage,
        familyPage,
        foreignPage,
        run,
      );
      if (run === 1) firstMarker.value = shared.marker;

      const familyEntry = familyPage
        .locator("article.soft-card")
        .filter({ hasText: shared.marker })
        .first();
      await expect(familyEntry).toBeVisible({ timeout: 20_000 });
      expect(familyNavigations).toBe(navigationBaseline);
      await assertForeignHouseholdDenied(foreignPage, shared.entryId, shared.marker);
      await completeFamilyActions(familyPage, shared.marker, shared.purchaseItem);

      if (run === 2) {
        const relatedPanel = familyPage.locator("section.soft-card").filter({
          has: familyPage.getByRole("heading", { name: "関連する申し送り" }),
        });
        await expect(relatedPanel.getByText("Qdrant検索結果")).toBeVisible({
          timeout: 30_000,
        });
        await expect(
          relatedPanel.getByRole("heading", {
            name: "類似する過去の申し送り",
          }),
        ).toBeVisible();
        await expect(relatedPanel.getByText(firstMarker.value)).toBeVisible();
        await expect(
          relatedPanel.getByRole("heading", { name: "必要品の重複候補" }),
        ).toBeVisible();
      }
      expect(Date.now() - startedAt).toBeLessThan(60_000);
    }

    await waitForVendorReadback(configuration, ledger);
  } finally {
    await Promise.all([
      helperContext.close(),
      familyContext.close(),
      foreignContext.close(),
    ]);
  }
});
