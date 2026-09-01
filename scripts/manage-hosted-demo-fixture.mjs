import { Buffer } from "node:buffer";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { QdrantClient } from "@qdrant/js-client-rest";
import { createClient } from "@supabase/supabase-js";

import { resolveNeo4jDatabase } from "./neo4j-connection.mjs";

export const HOMERELAY_HOSTED_PROJECT = Object.freeze({
  ref: "czfmqaeqamepntpsakbv",
  url: "https://czfmqaeqamepntpsakbv.supabase.co",
});

export const HOSTED_FIXTURE_ENV = Object.freeze({
  enabledProject: "HOMERELAY_HOSTED_FIXTURE_PROJECT",
  familyPassword: "HOMERELAY_CLOUD_FAMILY_PASSWORD",
  foreignFamilyPassword: "HOMERELAY_CLOUD_FOREIGN_FAMILY_PASSWORD",
  helperPassword: "HOMERELAY_CLOUD_HELPER_PASSWORD",
  neo4jDatabasePin: "HOMERELAY_HOSTED_NEO4J_DATABASE",
  neo4jUriPin: "HOMERELAY_HOSTED_NEO4J_URI",
  publishableKey: "HOMERELAY_CLOUD_SUPABASE_PUBLISHABLE_KEY",
  qdrantCollectionPin: "HOMERELAY_HOSTED_QDRANT_COLLECTION",
  qdrantUrlPin: "HOMERELAY_HOSTED_QDRANT_URL",
  secretKey: "HOMERELAY_CLOUD_SUPABASE_SECRET_KEY",
  url: "HOMERELAY_CLOUD_SUPABASE_URL",
});

export const FIXTURE_ACCOUNTS = Object.freeze({
  family: Object.freeze({
    email: "family-a@homerelay.test",
    passwordEnvironmentName: HOSTED_FIXTURE_ENV.familyPassword,
    role: "family",
  }),
  foreignFamily: Object.freeze({
    email: "family-b@homerelay.test",
    passwordEnvironmentName: HOSTED_FIXTURE_ENV.foreignFamilyPassword,
    role: "family",
  }),
  helper: Object.freeze({
    email: "helper-a@homerelay.test",
    passwordEnvironmentName: HOSTED_FIXTURE_ENV.helperPassword,
    role: "helper",
  }),
});

export const CLEANUP_STAGE_NAMES = Object.freeze([
  "qdrant",
  "neo4j",
  "storage",
  "database",
  "auth",
]);

const LEDGER_VERSION = 1;
const PHOTO_BUCKET = "handoff-photos";
const PUBLIC_TABLES = Object.freeze([
  "households",
  "members",
  "entries",
  "needed_items",
  "acknowledgements",
]);
const DEFAULT_QDRANT_COLLECTION = "homerelay_entries";
const DEFAULT_QDRANT_TIMEOUT_MS = 4_000;
const DEFAULT_NEO4J_TIMEOUT_MS = 4_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const PREFIX = "[hosted-fixture]";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_LEDGER_KEY =
  /(?:authorization|cookie|credential|email|key|password|secret|session|token)/i;
const NEO4J_FIXTURE_SCOPE = [
  "(n:HomeRelayHousehold AND n.id IN $householdIds)",
  "(n:HomeRelayMember AND n.householdId IN $householdIds)",
  "(n:HomeRelayHandoff AND n.householdId IN $householdIds)",
  "(n:HomeRelayNeededItem AND n.householdId IN $householdIds)",
  "(n:HomeRelayItemConcept AND n.householdId IN $householdIds)",
].join(" OR ");

class SafeFixtureError extends Error {
  constructor(code) {
    super(code);
    this.name = "SafeFixtureError";
  }
}

function fail(code) {
  throw new SafeFixtureError(code);
}

function assert(condition, code) {
  if (!condition) fail(code);
}

function safeCode(error, fallback = "unexpected_fixture_failure") {
  return error instanceof SafeFixtureError ? error.message : fallback;
}

function normalized(environment, name) {
  return environment[name]?.trim() ?? "";
}

function firstConfigured(environment, names) {
  for (const name of names) {
    const value = environment[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return { name, value: value.trim() };
    }
  }
  return null;
}

function decodeJwtRole(value) {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function isPublishableKey(value) {
  return (
    /^sb_publishable_[A-Za-z0-9_-]{16,}$/i.test(value) ||
    decodeJwtRole(value) === "anon"
  );
}

function isSecretKey(value) {
  return (
    /^sb_secret_[A-Za-z0-9_-]{16,}$/i.test(value) ||
    decodeJwtRole(value) === "service_role"
  );
}

function isStrongSyntheticPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 256 &&
    !/[\r\n\u0000]/.test(value) &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

function parseExactHostedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    return null;
  }
  return url.origin;
}

function parseQdrantConfig(environment) {
  const urlValue = normalized(environment, "QDRANT_URL");
  const apiKey = environment.QDRANT_API_KEY;
  if (!urlValue || !apiKey) return null;
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    fail("qdrant_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    fail("qdrant_url_unsafe");
  }
  const collection =
    normalized(environment, "QDRANT_COLLECTION") || DEFAULT_QDRANT_COLLECTION;
  const timeoutText = normalized(environment, "QDRANT_TIMEOUT_MS");
  const timeoutMs = timeoutText ? Number(timeoutText) : DEFAULT_QDRANT_TIMEOUT_MS;
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(collection) &&
      Number.isSafeInteger(timeoutMs) &&
      timeoutMs >= 250 &&
      timeoutMs <= 15_000,
    "qdrant_config_invalid",
  );
  return Object.freeze({
    apiKey,
    collection,
    timeoutMs,
    url: url.toString().replace(/\/$/, ""),
  });
}

function parseNeo4jConfig(environment) {
  const uriValue = normalized(environment, "NEO4J_URI");
  const username = normalized(environment, "NEO4J_USERNAME");
  const password = environment.NEO4J_PASSWORD;
  if (!uriValue || !username || !password) return null;
  assert(
    !username.includes(":") &&
      !/[\u0000-\u001f\u007f]/.test(username) &&
      !/[\u0000-\u001f\u007f]/.test(password),
    "neo4j_credentials_invalid",
  );
  let uri;
  try {
    uri = new URL(uriValue);
  } catch {
    fail("neo4j_uri_invalid");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname);
  assert(
    !uri.username &&
      !uri.password &&
      !uri.search &&
      !uri.hash &&
      ["", "/"].includes(uri.pathname) &&
      ["https:", "neo4j+s:", ...(loopback ? ["http:"] : [])].includes(
        uri.protocol,
      ),
    "neo4j_uri_unsafe",
  );
  const timeoutText = normalized(environment, "NEO4J_TIMEOUT_MS");
  const timeoutMs = timeoutText ? Number(timeoutText) : DEFAULT_NEO4J_TIMEOUT_MS;
  assert(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 250 && timeoutMs <= 15_000,
    "neo4j_timeout_invalid",
  );
  const database = resolveNeo4jDatabase({
    explicitDatabase: environment.NEO4J_DATABASE,
    uri,
    username,
  });
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(database),
    "neo4j_database_invalid",
  );
  const origin =
    uri.protocol === "neo4j+s:"
      ? `https://${uri.host}`
      : uri.toString().replace(/\/$/, "");
  return Object.freeze({
    authorization: Buffer.from(`${username}:${password}`, "utf8").toString(
      "base64",
    ),
    endpoint: `${origin}/db/${encodeURIComponent(database)}/query/v2`,
    timeoutMs,
  });
}

export function loadHostedFixtureConfig(environment = process.env) {
  if (
    normalized(environment, HOSTED_FIXTURE_ENV.enabledProject) !==
    HOMERELAY_HOSTED_PROJECT.ref
  ) {
    return Object.freeze({
      missing: Object.freeze([HOSTED_FIXTURE_ENV.enabledProject]),
      status: "skip",
    });
  }
  if (
    normalized(environment, "HOMERELAY_DATA_MODE").toLowerCase() !== "supabase" ||
    normalized(environment, "HOMERELAY_DEMO_MODE").toLowerCase() === "true"
  ) {
    return Object.freeze({ reason: "live_mode_required", status: "invalid" });
  }
  if (
    normalized(environment, "HOMERELAY_E2E_ISOLATE_VENDORS").toLowerCase() ===
    "true"
  ) {
    return Object.freeze({ reason: "vendor_isolation_not_allowed", status: "invalid" });
  }

  const urlSetting = firstConfigured(environment, [
    HOSTED_FIXTURE_ENV.url,
    "NEXT_PUBLIC_SUPABASE_URL",
  ]);
  const publishableSetting = firstConfigured(environment, [
    HOSTED_FIXTURE_ENV.publishableKey,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);
  const secretSetting = firstConfigured(environment, [
    HOSTED_FIXTURE_ENV.secretKey,
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  const missing = [];
  if (!urlSetting) missing.push(HOSTED_FIXTURE_ENV.url);
  if (!publishableSetting) missing.push(HOSTED_FIXTURE_ENV.publishableKey);
  if (!secretSetting) missing.push(HOSTED_FIXTURE_ENV.secretKey);
  for (const account of Object.values(FIXTURE_ACCOUNTS)) {
    if (!environment[account.passwordEnvironmentName]) {
      missing.push(account.passwordEnvironmentName);
    }
  }
  if (!environment.QDRANT_URL) missing.push("QDRANT_URL");
  if (!environment.QDRANT_API_KEY) missing.push("QDRANT_API_KEY");
  if (!environment.NEO4J_URI) missing.push("NEO4J_URI");
  if (!environment.NEO4J_USERNAME) missing.push("NEO4J_USERNAME");
  if (!environment.NEO4J_PASSWORD) missing.push("NEO4J_PASSWORD");
  if (!environment[HOSTED_FIXTURE_ENV.qdrantUrlPin]) {
    missing.push(HOSTED_FIXTURE_ENV.qdrantUrlPin);
  }
  if (!environment[HOSTED_FIXTURE_ENV.qdrantCollectionPin]) {
    missing.push(HOSTED_FIXTURE_ENV.qdrantCollectionPin);
  }
  if (!environment[HOSTED_FIXTURE_ENV.neo4jUriPin]) {
    missing.push(HOSTED_FIXTURE_ENV.neo4jUriPin);
  }
  if (!environment[HOSTED_FIXTURE_ENV.neo4jDatabasePin]) {
    missing.push(HOSTED_FIXTURE_ENV.neo4jDatabasePin);
  }
  if (missing.length > 0) {
    return Object.freeze({ missing: Object.freeze(missing), status: "skip" });
  }

  const url = parseExactHostedUrl(urlSetting.value);
  if (url !== HOMERELAY_HOSTED_PROJECT.url) {
    return Object.freeze({ reason: "wrong_supabase_project", status: "invalid" });
  }
  if (!isPublishableKey(publishableSetting.value)) {
    return Object.freeze({ reason: "publishable_key_required", status: "invalid" });
  }
  if (!isSecretKey(secretSetting.value)) {
    return Object.freeze({ reason: "server_secret_key_required", status: "invalid" });
  }

  const accounts = Object.fromEntries(
    Object.entries(FIXTURE_ACCOUNTS).map(([name, account]) => [
      name,
      Object.freeze({
        ...account,
        password: environment[account.passwordEnvironmentName],
      }),
    ]),
  );
  const passwords = Object.values(accounts).map(({ password }) => password);
  if (!passwords.every(isStrongSyntheticPassword)) {
    return Object.freeze({ reason: "strong_test_passwords_required", status: "invalid" });
  }
  if (new Set(passwords).size !== passwords.length) {
    return Object.freeze({ reason: "distinct_test_passwords_required", status: "invalid" });
  }

  let qdrant;
  let neo4j;
  try {
    qdrant = parseQdrantConfig(environment);
    neo4j = parseNeo4jConfig(environment);
  } catch (error) {
    return Object.freeze({ reason: safeCode(error), status: "invalid" });
  }
  assert(qdrant && neo4j, "vendor_config_required");
  const qdrantPin = parseQdrantConfig({
    QDRANT_API_KEY: environment.QDRANT_API_KEY,
    QDRANT_COLLECTION: environment[HOSTED_FIXTURE_ENV.qdrantCollectionPin],
    QDRANT_TIMEOUT_MS: environment.QDRANT_TIMEOUT_MS,
    QDRANT_URL: environment[HOSTED_FIXTURE_ENV.qdrantUrlPin],
  });
  const neo4jPin = parseNeo4jConfig({
    NEO4J_DATABASE: environment[HOSTED_FIXTURE_ENV.neo4jDatabasePin],
    NEO4J_PASSWORD: environment.NEO4J_PASSWORD,
    NEO4J_TIMEOUT_MS: environment.NEO4J_TIMEOUT_MS,
    NEO4J_URI: environment[HOSTED_FIXTURE_ENV.neo4jUriPin],
    NEO4J_USERNAME: environment.NEO4J_USERNAME,
  });
  assert(
    qdrantPin?.url === qdrant.url &&
      qdrantPin?.collection === qdrant.collection &&
      neo4jPin?.endpoint === neo4j.endpoint,
    "vendor_resource_pin_mismatch",
  );

  return Object.freeze({
    config: Object.freeze({
      accounts: Object.freeze(accounts),
      neo4j,
      publishableKey: publishableSetting.value,
      qdrant,
      secretKey: secretSetting.value,
      url,
    }),
    status: "ready",
  });
}

function hasForbiddenLedgerKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_LEDGER_KEY.test(key) || hasForbiddenLedgerKey(child),
  );
}

function fixtureIdsAreValid(fixture) {
  const records = [fixture?.family, fixture?.foreignFamily, fixture?.helper];
  if (!records.every(
    (record) =>
      record &&
      UUID_PATTERN.test(record.householdId) &&
      UUID_PATTERN.test(record.memberId) &&
      (record.authUserId === null || UUID_PATTERN.test(record.authUserId)),
  )) {
    return false;
  }
  const [family, foreignFamily, helper] = records;
  const authIds = records.map(({ authUserId }) => authUserId).filter(Boolean);
  return (
    family.householdId === helper.householdId &&
    foreignFamily.householdId !== family.householdId &&
    new Set(records.map(({ memberId }) => memberId)).size === records.length &&
    new Set(authIds).size === authIds.length
  );
}

function fixtureStoragePathIsValid(path, ledger) {
  if (typeof path !== "string" || path.length === 0 || path.length > 500) {
    return false;
  }
  const segments = path.split("/");
  if (segments.length !== 3) return false;
  const [householdId, memberId, fileName] = segments;
  const allowedPair = Object.values(ledger.fixture).some(
    (fixture) =>
      fixture.householdId === householdId && fixture.memberId === memberId,
  );
  const match = fileName.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})[.](jpe?g|png|webp)$/i,
  );
  return allowedPair && Boolean(match && UUID_PATTERN.test(match[1]));
}

export function validateFixtureStoragePaths(paths, ledger) {
  assert(
    Array.isArray(paths) &&
      new Set(paths).size === paths.length &&
      paths.every((path) => fixtureStoragePathIsValid(path, ledger)),
    "fixture_storage_path_unsafe",
  );
  return paths;
}

export function validateFixtureLedger(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "ledger_invalid");
  assert(!hasForbiddenLedgerKey(value), "ledger_contains_forbidden_key");
  assert(value.version === LEDGER_VERSION, "ledger_version_invalid");
  assert(value.projectRef === HOMERELAY_HOSTED_PROJECT.ref, "ledger_project_invalid");
  assert(
    [
      "provisioning",
      "provision_failed",
      "ready",
      "cleanup_in_progress",
      "cleanup_failed",
      "cleaned",
    ].includes(value.state),
    "ledger_state_invalid",
  );
  assert(fixtureIdsAreValid(value.fixture), "ledger_fixture_ids_invalid");
  assert(
    typeof value.createdAt === "string" &&
      Number.isFinite(Date.parse(value.createdAt)) &&
      typeof value.updatedAt === "string" &&
      Number.isFinite(Date.parse(value.updatedAt)),
    "ledger_timestamp_invalid",
  );
  if (Object.hasOwn(value, "lastFailureCode")) {
    assert(
      typeof value.lastFailureCode === "string" &&
        /^[a-z0-9_]{1,100}$/.test(value.lastFailureCode),
      "ledger_failure_code_invalid",
    );
  }
  assert(Array.isArray(value.storagePaths), "ledger_storage_paths_invalid");
  try {
    validateFixtureStoragePaths(value.storagePaths, value);
  } catch {
    fail("ledger_storage_paths_invalid");
  }
  assert(
    Array.isArray(value.cleanupCompletedStages) &&
      value.cleanupCompletedStages.every((stage) => CLEANUP_STAGE_NAMES.includes(stage)),
    "ledger_cleanup_stages_invalid",
  );
  assert(
    new Set(value.cleanupCompletedStages).size === value.cleanupCompletedStages.length,
    "ledger_cleanup_stages_invalid",
  );
  return value;
}

export function createInitialFixtureLedger({
  now = () => new Date().toISOString(),
  randomUuid = randomUUID,
} = {}) {
  const primaryHouseholdId = randomUuid();
  const foreignHouseholdId = randomUuid();
  const ledger = {
    cleanupCompletedStages: [],
    createdAt: now(),
    fixture: {
      family: {
        authUserId: null,
        householdId: primaryHouseholdId,
        memberId: randomUuid(),
      },
      foreignFamily: {
        authUserId: null,
        householdId: foreignHouseholdId,
        memberId: randomUuid(),
      },
      helper: {
        authUserId: null,
        householdId: primaryHouseholdId,
        memberId: randomUuid(),
      },
    },
    projectRef: HOMERELAY_HOSTED_PROJECT.ref,
    state: "provisioning",
    storagePaths: [],
    updatedAt: now(),
    version: LEDGER_VERSION,
  };
  return validateFixtureLedger(ledger);
}

export function serializeFixtureLedger(ledger) {
  validateFixtureLedger(ledger);
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

function defaultLedgerStore(root = process.cwd()) {
  const ledgerPath = resolve(root, ".vercel", "homerelay-hosted-fixture.json");
  return {
    async exists() {
      try {
        const status = await lstat(ledgerPath);
        assert(status.isFile() && !status.isSymbolicLink(), "ledger_path_unsafe");
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },
    async load() {
      const status = await lstat(ledgerPath);
      assert(status.isFile() && !status.isSymbolicLink(), "ledger_path_unsafe");
      try {
        return validateFixtureLedger(JSON.parse(await readFile(ledgerPath, "utf8")));
      } catch (error) {
        if (error instanceof SafeFixtureError) throw error;
        fail("ledger_read_failed");
      }
    },
    async remove() {
      const status = await lstat(ledgerPath);
      assert(status.isFile() && !status.isSymbolicLink(), "ledger_path_unsafe");
      await rm(ledgerPath);
    },
    async save(ledger) {
      const parent = dirname(ledgerPath);
      await mkdir(parent, { recursive: true });
      const parentStatus = await lstat(parent);
      assert(parentStatus.isDirectory() && !parentStatus.isSymbolicLink(), "ledger_path_unsafe");
      try {
        const current = await lstat(ledgerPath);
        assert(current.isFile() && !current.isSymbolicLink(), "ledger_path_unsafe");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const temporaryPath = `${ledgerPath}.tmp-${process.pid}`;
      try {
        await writeFile(temporaryPath, serializeFixtureLedger(ledger), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporaryPath, ledgerPath);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
    },
  };
}

function updateLedger(ledger, patch, now) {
  Object.assign(ledger, patch, { updatedAt: now() });
  return validateFixtureLedger(ledger);
}

export async function executeProvisionPlan({
  accounts,
  createHouseholds,
  createMembers,
  inviteAccount,
  ledger,
  now = () => new Date().toISOString(),
  preflight,
  saveLedger,
  verifyReady,
}) {
  let ledgerSaved = false;
  try {
    await preflight(ledger);
    await saveLedger(ledger);
    ledgerSaved = true;
    for (const accountName of ["family", "helper", "foreignFamily"]) {
      const account = accounts[accountName];
      await inviteAccount(accountName, account, async (authUserId) => {
        assert(UUID_PATTERN.test(authUserId), "invited_user_id_invalid");
        ledger.fixture[accountName].authUserId = authUserId;
        await saveLedger(updateLedger(ledger, {}, now));
      });
    }
    await createHouseholds(ledger);
    await createMembers(ledger);
    await verifyReady(ledger);
    await saveLedger(updateLedger(ledger, { state: "ready" }, now));
    return ledger;
  } catch (error) {
    const code = safeCode(error, "fixture_provision_failed");
    if (ledgerSaved) {
      try {
        await saveLedger(
          updateLedger(ledger, { lastFailureCode: code, state: "provision_failed" }, now),
        );
      } catch {
        fail("fixture_provision_and_ledger_update_failed");
      }
    }
    fail(code);
  }
}

function snapshotIsZero(snapshot) {
  const values = [
    snapshot?.supabase?.authUsers,
    snapshot?.supabase?.households,
    snapshot?.supabase?.members,
    snapshot?.supabase?.entries,
    snapshot?.supabase?.neededItems,
    snapshot?.supabase?.acknowledgements,
    snapshot?.supabase?.storageObjects,
    snapshot?.qdrant?.fixturePoints,
    snapshot?.neo4j?.fixtureNodes,
    snapshot?.neo4j?.fixtureRelationships,
  ];
  return values.length === 10 && values.every((value) => value === 0);
}

export async function executeCleanupPlan({
  ledger,
  now = () => new Date().toISOString(),
  readSnapshot,
  saveLedger,
  settle = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  stages,
}) {
  if (["cleanup_in_progress", "cleanup_failed", "cleaned"].includes(ledger.state)) {
    fail("cleanup_retry_refused");
  }
  const startedFromState = ledger.state;
  await saveLedger(
    updateLedger(
      ledger,
      { cleanupCompletedStages: [], state: "cleanup_in_progress" },
      now,
    ),
  );
  for (const stageName of CLEANUP_STAGE_NAMES) {
    try {
      await stages[stageName](ledger, { startedFromState });
      ledger.cleanupCompletedStages.push(stageName);
      await saveLedger(updateLedger(ledger, {}, now));
    } catch (error) {
      const code = safeCode(error, `${stageName}_cleanup_failed`);
      await saveLedger(
        updateLedger(
          ledger,
          { lastFailureCode: code, state: "cleanup_failed" },
          now,
        ),
      );
      fail(code);
    }
  }

  try {
    const first = await readSnapshot(ledger);
    assert(snapshotIsZero(first), "first_cleanup_readback_not_zero");
    await settle();
    const second = await readSnapshot(ledger);
    assert(snapshotIsZero(second), "second_cleanup_readback_not_zero");
    await saveLedger(updateLedger(ledger, { state: "cleaned" }, now));
    return { first, second };
  } catch (error) {
    const code = safeCode(error, "cleanup_readback_failed");
    await saveLedger(
      updateLedger(
        ledger,
        { lastFailureCode: code, state: "cleanup_failed" },
        now,
      ),
    );
    fail(code);
  }
}

function createTimedFetch(timeoutMs = REQUEST_TIMEOUT_MS) {
  return (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return fetch(input, { ...init, redirect: "error", signal });
  };
}

function createSupabaseClients(config) {
  const common = {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: createTimedFetch() },
  };
  return {
    admin: createClient(config.url, config.secretKey, common),
    createPublic: () => createClient(config.url, config.publishableKey, common),
  };
}

function requireSdkSuccess(result, code, validator = () => true) {
  assert(result?.error === null && validator(result.data), code);
  return result.data;
}

async function neo4jExecute(config, statement, parameters) {
  assert(
    typeof statement === "string" && statement.length > 0 && statement.length <= 20_000,
    "neo4j_statement_invalid",
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpoint, {
      body: JSON.stringify({ parameters, statement }),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${config.authorization}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
    assert(response.ok, "neo4j_query_http_error");
    const text = await response.text();
    assert(text.length <= MAX_RESPONSE_BYTES, "neo4j_response_too_large");
    const body = JSON.parse(text);
    assert(
      body &&
        (!Array.isArray(body.errors) || body.errors.length === 0) &&
        Array.isArray(body.data?.fields) &&
        Array.isArray(body.data?.values),
      "neo4j_response_invalid",
    );
    return body.data;
  } catch (error) {
    if (error instanceof SafeFixtureError) throw error;
    fail("neo4j_query_failed");
  } finally {
    clearTimeout(timer);
  }
}

function householdIds(ledger) {
  return [
    ...new Set(Object.values(ledger.fixture).map(({ householdId }) => householdId)),
  ];
}

function memberFolders(ledger) {
  return Object.values(ledger.fixture).map(
    ({ householdId, memberId }) => `${householdId}/${memberId}`,
  );
}

async function supabaseGlobalSnapshot(admin) {
  const usersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  const userData = requireSdkSuccess(
    usersResult,
    "auth_snapshot_failed",
    (data) => Array.isArray(data?.users),
  );
  const counts = {};
  for (const table of PUBLIC_TABLES) {
    const result = await admin.from(table).select("id", { count: "exact", head: true });
    requireSdkSuccess(result, `${table}_snapshot_failed`, (data) => data === null);
    assert(Number.isInteger(result.count), `${table}_snapshot_count_invalid`);
    counts[table] = result.count;
  }
  const storageResult = await admin.storage.from(PHOTO_BUCKET).list("", {
    limit: 1_000,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });
  const storage = requireSdkSuccess(
    storageResult,
    "storage_snapshot_failed",
    Array.isArray,
  );
  return {
    acknowledgements: counts.acknowledgements,
    authUsers: userData.users.length,
    entries: counts.entries,
    households: counts.households,
    members: counts.members,
    neededItems: counts.needed_items,
    storageObjects: storage.length,
  };
}

async function qdrantFixtureCount(client, config, ledger) {
  let count = 0;
  for (const householdId of householdIds(ledger)) {
    const response = await client.scroll(config.collection, {
      filter: { must: [{ key: "household_id", match: { value: householdId } }] },
      limit: 1,
      timeout: Math.max(1, Math.ceil(config.timeoutMs / 1_000)),
      with_payload: false,
      with_vector: false,
    });
    assert(Array.isArray(response?.points), "qdrant_readback_invalid");
    count += response.points.length;
  }
  return count;
}

async function neo4jFixtureCount(config, ledger) {
  const result = await neo4jExecute(
    config,
    `MATCH (n) WHERE ${NEO4J_FIXTURE_SCOPE} OPTIONAL MATCH (n)-[r]-() RETURN count(DISTINCT n) AS nodeCount, count(DISTINCT r) AS relationshipCount`,
    { householdIds: householdIds(ledger) },
  );
  assert(
    result.fields?.[0] === "nodeCount" &&
      result.fields?.[1] === "relationshipCount" &&
      result.values?.length === 1 &&
      Number.isInteger(result.values[0]?.[0]) &&
      Number.isInteger(result.values[0]?.[1]),
    "neo4j_readback_invalid",
  );
  return {
    fixtureNodes: result.values[0][0],
    fixtureRelationships: result.values[0][1],
  };
}

function createRuntime(config) {
  const supabase = createSupabaseClients(config);
  const qdrant = new QdrantClient({
    apiKey: config.qdrant.apiKey,
    checkCompatibility: true,
    timeout: config.qdrant.timeoutMs,
    url: config.qdrant.url,
  });
  return {
    ...supabase,
    async close() {
      supabase.admin.realtime.disconnect();
    },
    async readSnapshot(ledger) {
      const [supabaseSnapshot, qdrantCount, neo4jSnapshot] = await Promise.all([
        supabaseGlobalSnapshot(supabase.admin),
        qdrantFixtureCount(qdrant, config.qdrant, ledger),
        neo4jFixtureCount(config.neo4j, ledger),
      ]);
      return {
        neo4j: neo4jSnapshot,
        qdrant: { fixturePoints: qdrantCount },
        supabase: supabaseSnapshot,
      };
    },
    qdrant,
  };
}

export async function inviteSyntheticAccount(runtime, account, rememberAuthUser) {
  const inviteResult = await runtime.admin.auth.admin.generateLink({
    email: account.email,
    options: { data: { source: "homerelay-hosted-fixture" } },
    type: "invite",
  });
  const invite = requireSdkSuccess(
    inviteResult,
    "invite_link_failed",
    (data) =>
      UUID_PATTERN.test(data?.user?.id ?? "") &&
      data?.user?.email?.toLowerCase() === account.email &&
      data?.properties?.verification_type === "invite" &&
      typeof data?.properties?.hashed_token === "string" &&
      data.properties.hashed_token.length > 0,
  );
  await rememberAuthUser(invite.user.id);

  const client = runtime.createPublic();
  let inviteSessionEstablished = false;
  try {
    const verificationResult = await client.auth.verifyOtp({
      token_hash: invite.properties.hashed_token,
      type: "invite",
    });
    inviteSessionEstablished =
      typeof verificationResult?.data?.session?.access_token === "string";
    requireSdkSuccess(
      verificationResult,
      "invite_redemption_failed",
      (data) =>
        data?.user?.id === invite.user.id &&
        typeof data?.session?.access_token === "string",
    );
    const passwordResult = await client.auth.updateUser({ password: account.password });
    requireSdkSuccess(
      passwordResult,
      "invited_password_set_failed",
      (data) => data?.user?.id === invite.user.id,
    );
  } finally {
    client.realtime.disconnect();
    if (inviteSessionEstablished) {
      const signOutResult = await client.auth.signOut({ scope: "global" });
      assert(signOutResult?.error === null, "invite_session_revoke_failed");
    }
  }
}

async function createFixtureHouseholds(admin, ledger) {
  const ids = householdIds(ledger);
  const result = await admin
    .from("households")
    .insert([
      { id: ids[0], name: "Synthetic HomeRelay household A" },
      { id: ids[1], name: "Synthetic HomeRelay household B" },
    ])
    .select("id");
  requireSdkSuccess(
    result,
    "household_create_failed",
    (data) => Array.isArray(data) && data.length === 2,
  );
}

async function createFixtureMembers(admin, ledger) {
  const records = [
    ["family", "Synthetic family A", "family"],
    ["helper", "Synthetic helper A", "helper"],
    ["foreignFamily", "Synthetic family B", "family"],
  ].map(([accountName, displayName, role]) => {
    const fixture = ledger.fixture[accountName];
    assert(UUID_PATTERN.test(fixture.authUserId ?? ""), "fixture_auth_id_missing");
    return {
      auth_user_id: fixture.authUserId,
      display_name: displayName,
      household_id: fixture.householdId,
      id: fixture.memberId,
      role,
    };
  });
  const result = await admin.from("members").insert(records).select("id");
  requireSdkSuccess(
    result,
    "member_create_failed",
    (data) => Array.isArray(data) && data.length === 3,
  );
}

function assertProvisionPreflight(snapshot) {
  assert(snapshotIsZero(snapshot), "project_not_empty_before_fixture");
}

function assertProvisionReady(snapshot) {
  assert(
    snapshot.supabase.authUsers === 3 &&
      snapshot.supabase.households === 2 &&
      snapshot.supabase.members === 3 &&
      snapshot.supabase.entries === 0 &&
      snapshot.supabase.neededItems === 0 &&
      snapshot.supabase.acknowledgements === 0 &&
      snapshot.supabase.storageObjects === 0 &&
      snapshot.qdrant.fixturePoints === 0 &&
      snapshot.neo4j.fixtureNodes === 0 &&
      snapshot.neo4j.fixtureRelationships === 0,
    "fixture_ready_readback_failed",
  );
}

async function collectStoragePaths(admin, ledger) {
  const paths = new Set(ledger.storagePaths);
  const ids = householdIds(ledger);
  for (const table of ["entries", "needed_items"]) {
    const result = await admin
      .from(table)
      .select("photo_path")
      .in("household_id", ids);
    const rows = requireSdkSuccess(
      result,
      `${table}_photo_lookup_failed`,
      Array.isArray,
    );
    for (const row of rows) {
      if (typeof row.photo_path === "string" && row.photo_path.length > 0) {
        paths.add(row.photo_path);
      }
    }
  }
  for (const folder of memberFolders(ledger)) {
    const result = await admin.storage.from(PHOTO_BUCKET).list(folder, {
      limit: 1_000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });
    const objects = requireSdkSuccess(
      result,
      "storage_path_discovery_failed",
      Array.isArray,
    );
    for (const object of objects) {
      if (typeof object?.name === "string" && object.name.length > 0) {
        paths.add(`${folder}/${object.name}`);
      }
    }
  }
  return [...paths];
}

export async function cleanupQdrant(runtime, config, ledger) {
  for (const householdId of householdIds(ledger)) {
    await runtime.qdrant.delete(config.collection, {
      filter: { must: [{ key: "household_id", match: { value: householdId } }] },
      timeout: Math.max(1, Math.ceil(config.timeoutMs / 1_000)),
      wait: true,
    });
  }
  assert(
    (await qdrantFixtureCount(runtime.qdrant, config, ledger)) === 0,
    "qdrant_cleanup_residual",
  );
}

export async function cleanupNeo4j(config, ledger) {
  await neo4jExecute(
    config,
    `MATCH (n) WHERE ${NEO4J_FIXTURE_SCOPE} DETACH DELETE n`,
    { householdIds: householdIds(ledger) },
  );
  const snapshot = await neo4jFixtureCount(config, ledger);
  assert(
    snapshot.fixtureNodes === 0 && snapshot.fixtureRelationships === 0,
    "neo4j_cleanup_residual",
  );
}

export async function cleanupStorage(admin, ledger) {
  const paths = validateFixtureStoragePaths(
    await collectStoragePaths(admin, ledger),
    ledger,
  );
  for (let index = 0; index < paths.length; index += 100) {
    const result = await admin.storage
      .from(PHOTO_BUCKET)
      .remove(paths.slice(index, index + 100));
    requireSdkSuccess(result, "storage_cleanup_failed", Array.isArray);
  }
  for (const folder of memberFolders(ledger)) {
    const result = await admin.storage.from(PHOTO_BUCKET).list(folder, {
      limit: 1,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });
    const objects = requireSdkSuccess(
      result,
      "storage_cleanup_readback_failed",
      Array.isArray,
    );
    assert(objects.length === 0, "storage_cleanup_residual");
  }
}

export async function cleanupDatabase(admin, ledger) {
  const ids = householdIds(ledger);
  for (const table of [
    "acknowledgements",
    "needed_items",
    "entries",
    "members",
    "households",
  ]) {
    const column = table === "households" ? "id" : "household_id";
    const result = await admin.from(table).delete().in(column, ids).select("id");
    requireSdkSuccess(result, `${table}_cleanup_failed`, Array.isArray);
  }
}

export async function cleanupAuth(
  runtime,
  accounts,
  ledger,
  { allowMissingPassword = false } = {},
) {
  const result = await runtime.admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  const users = requireSdkSuccess(
    result,
    "auth_cleanup_lookup_failed",
    (data) => Array.isArray(data?.users),
  ).users;
  const fixtureUsers = [];
  for (const [accountName, account] of Object.entries(accounts)) {
    const expectedId = ledger.fixture[accountName].authUserId;
    const expectedEmail = account.email.toLowerCase();
    const user = users.find(
      (candidate) =>
        (expectedId && candidate.id === expectedId) ||
        candidate.email?.toLowerCase() === expectedEmail,
    );
    if (!user) continue;
    assert(
      user.email?.toLowerCase() === expectedEmail &&
        (!expectedId || user.id === expectedId),
      "auth_fixture_identity_mismatch",
    );
    fixtureUsers.push({ account, user });
  }

  for (const { account, user } of fixtureUsers) {
    const client = runtime.createPublic();
    try {
      const signInResult = await client.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      const passwordSessionValid =
        signInResult?.error === null &&
        signInResult?.data?.user?.id === user.id &&
        typeof signInResult?.data?.session?.access_token === "string";
      if (passwordSessionValid) {
        const signOutResult = await client.auth.signOut({ scope: "global" });
        assert(signOutResult?.error === null, "auth_session_revoke_failed");
      } else {
        assert(allowMissingPassword, "auth_session_lookup_failed");
      }
    } finally {
      client.realtime.disconnect();
    }
    const deleteResult = await runtime.admin.auth.admin.deleteUser(user.id);
    requireSdkSuccess(deleteResult, "auth_cleanup_failed");
  }
}

function safeSnapshotForLog(snapshot) {
  return {
    neo4j: snapshot.neo4j,
    qdrant: snapshot.qdrant,
    supabase: snapshot.supabase,
  };
}

export async function runHostedFixtureCommand(
  command,
  {
    environment = process.env,
    ledgerStore = defaultLedgerStore(),
    logger = console,
    runtimeFactory = createRuntime,
  } = {},
) {
  const loaded = loadHostedFixtureConfig(environment);
  if (loaded.status === "skip") {
    logger.log(`${PREFIX} SKIP: required names are missing (${loaded.missing.join(", ")})`);
    fail("fixture_configuration_missing");
  }
  if (loaded.status === "invalid") fail(loaded.reason);
  assert(["provision", "snapshot", "cleanup"].includes(command), "command_invalid");

  const runtime = runtimeFactory(loaded.config);
  try {
    if (command === "provision") {
      assert(!(await ledgerStore.exists()), "fixture_ledger_already_exists");
      const ledger = createInitialFixtureLedger();
      await executeProvisionPlan({
        accounts: loaded.config.accounts,
        createHouseholds: (value) => createFixtureHouseholds(runtime.admin, value),
        createMembers: (value) => createFixtureMembers(runtime.admin, value),
        inviteAccount: (_name, account, remember) =>
          inviteSyntheticAccount(runtime, account, remember),
        ledger,
        preflight: async (value) => {
          const collection = await runtime.qdrant.collectionExists(
            loaded.config.qdrant.collection,
          );
          assert(collection?.exists === true, "qdrant_collection_missing");
          assertProvisionPreflight(await runtime.readSnapshot(value));
        },
        saveLedger: (value) => ledgerStore.save(value),
        verifyReady: async (value) => assertProvisionReady(await runtime.readSnapshot(value)),
      });
      logger.log(`${PREFIX} PASS: invited synthetic fixture is ready`);
      return { status: "provisioned" };
    }

    assert(await ledgerStore.exists(), "fixture_ledger_missing");
    const ledger = await ledgerStore.load();
    if (command === "snapshot") {
      const snapshot = await runtime.readSnapshot(ledger);
      logger.log(`${PREFIX} SNAPSHOT ${JSON.stringify(safeSnapshotForLog(snapshot))}`);
      return { snapshot, status: "snapshot" };
    }

    const result = await executeCleanupPlan({
      ledger,
      readSnapshot: (value) => runtime.readSnapshot(value),
      saveLedger: (value) => ledgerStore.save(value),
      stages: {
        auth: (value, context) =>
          cleanupAuth(runtime, loaded.config.accounts, value, {
            allowMissingPassword: context.startedFromState !== "ready",
          }),
        database: (value) => cleanupDatabase(runtime.admin, value),
        neo4j: (value) => cleanupNeo4j(loaded.config.neo4j, value),
        qdrant: (value) => cleanupQdrant(runtime, loaded.config.qdrant, value),
        storage: (value) => cleanupStorage(runtime.admin, value),
      },
    });
    await ledgerStore.remove();
    logger.log(
      `${PREFIX} PASS: cleanup and two independent zero read-backs completed`,
    );
    return { ...result, status: "cleaned" };
  } finally {
    await runtime.close();
  }
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  runHostedFixtureCommand(process.argv[2]).catch((error) => {
    console.error(`${PREFIX} FAIL ${safeCode(error)}`);
    process.exitCode = 1;
  });
}
