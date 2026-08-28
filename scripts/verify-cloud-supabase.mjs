import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

export const CLOUD_SUPABASE_ENV = Object.freeze({
  enabled: "HOMERELAY_CLOUD_SUPABASE_VERIFY",
  familyEmail: "HOMERELAY_CLOUD_FAMILY_EMAIL",
  familyPassword: "HOMERELAY_CLOUD_FAMILY_PASSWORD",
  foreignFamilyEmail: "HOMERELAY_CLOUD_FOREIGN_FAMILY_EMAIL",
  foreignFamilyPassword: "HOMERELAY_CLOUD_FOREIGN_FAMILY_PASSWORD",
  helperEmail: "HOMERELAY_CLOUD_HELPER_EMAIL",
  helperPassword: "HOMERELAY_CLOUD_HELPER_PASSWORD",
  publishableKey: "HOMERELAY_CLOUD_SUPABASE_PUBLISHABLE_KEY",
  secretKey: "HOMERELAY_CLOUD_SUPABASE_SECRET_KEY",
  url: "HOMERELAY_CLOUD_SUPABASE_URL",
});

export const HOMERELAY_CLOUD_PROJECT = Object.freeze({
  ref: "czfmqaeqamepntpsakbv",
  url: "https://czfmqaeqamepntpsakbv.supabase.co",
});

const PHOTO_BUCKET = "handoff-photos";
const SYNTHETIC_EMAIL_SUFFIX = "@homerelay.test";
const REQUEST_TIMEOUT_MS = 20_000;
const FINAL_CLEANUP_SETTLE_MS = REQUEST_TIMEOUT_MS + 2_000;
const SUBSCRIBE_TIMEOUT_MS = 20_000;
const EVENT_TIMEOUT_MS = 35_000;
const NEGATIVE_OBSERVATION_MS = 2_000;
const RECOVERY_SETTLE_MS = 2_000;
const PREFIX = "[verify-cloud-supabase]";
const SYNTHETIC_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const SYNTHETIC_UPDATED_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x01, 0xff, 0xd9,
]);
const PUBLIC_TABLES = Object.freeze([
  "households",
  "members",
  "entries",
  "needed_items",
  "acknowledgements",
]);

const REQUIRED_ENV_NAMES = Object.freeze([
  CLOUD_SUPABASE_ENV.url,
  CLOUD_SUPABASE_ENV.publishableKey,
  CLOUD_SUPABASE_ENV.secretKey,
  CLOUD_SUPABASE_ENV.familyEmail,
  CLOUD_SUPABASE_ENV.familyPassword,
  CLOUD_SUPABASE_ENV.helperEmail,
  CLOUD_SUPABASE_ENV.helperPassword,
  CLOUD_SUPABASE_ENV.foreignFamilyEmail,
  CLOUD_SUPABASE_ENV.foreignFamilyPassword,
]);

class SafeVerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = "SafeVerificationError";
  }
}

function toSafeFailure(error, fallbackCode) {
  return error instanceof SafeVerificationError
    ? error
    : new SafeVerificationError(fallbackCode);
}

function combineSafeFailures(...errors) {
  const codes = errors
    .filter(Boolean)
    .flatMap((error) => toSafeFailure(error, "unexpected_verification_failure").message.split("__and__"));
  const uniqueCodes = [...new Set(codes)];
  return uniqueCodes.length > 0
    ? new SafeVerificationError(uniqueCodes.join("__and__"))
    : null;
}

function waitForRecoverySettle() {
  return new Promise((resolve) => setTimeout(resolve, RECOVERY_SETTLE_MS));
}

function waitForFinalCleanupSettle() {
  return new Promise((resolve) => setTimeout(resolve, FINAL_CLEANUP_SETTLE_MS));
}

function fail(code) {
  throw new SafeVerificationError(code);
}

function assert(condition, code) {
  if (!condition) fail(code);
}

function numericStatus(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function classifySupabaseError(error) {
  if (!error || typeof error !== "object") return "unknown";
  const statuses = [numericStatus(error.status), numericStatus(error.statusCode)].filter(
    (status) => status !== null,
  );
  const code = typeof error.code === "string" ? error.code : "";
  const name = typeof error.name === "string" ? error.name : "";

  // Infrastructure failures take precedence over an accompanying SQL or
  // Storage semantic code; they must never count as an authorization PASS.
  if (statuses.includes(429)) return "rate_limited";
  if (statuses.some((status) => status >= 500)) return "server_error";
  if (
    ["AbortError", "TimeoutError"].includes(name) ||
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code)
  ) {
    return "timeout";
  }
  if (
    name === "FetchError" ||
    name === "TypeError" ||
    ["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH"].includes(code)
  ) {
    return "network_error";
  }
  // A 401 is accepted only in the live flow after sign-in and membership
  // lookup have already proved that the synthetic session is valid.
  if (statuses.some((status) => status === 401 || status === 403) || code === "42501") {
    return "authorization_denied";
  }
  return "unexpected";
}

export function requireSdkSuccess(result, failureCode, validateData = () => true) {
  assert(
    result &&
      typeof result === "object" &&
      Object.hasOwn(result, "error") &&
      result.error === null &&
      validateData(result.data),
    failureCode,
  );
  return result.data;
}

export function requireAdminInviteLink(result, expectedEmail) {
  const data = requireSdkSuccess(
    result,
    "admin_invite_check_failed",
    (value) =>
      typeof value?.user?.id === "string" &&
      value.user.email?.toLowerCase() === expectedEmail.toLowerCase() &&
      value?.properties?.verification_type === "invite" &&
      typeof value.properties.hashed_token === "string" &&
      value.properties.hashed_token.length > 0 &&
      typeof value.properties.action_link === "string" &&
      value.properties.action_link.length > 0,
  );
  return data.user;
}

export function requireAuthorizationDenial(result, failureCode) {
  if (
    result &&
    typeof result === "object" &&
    result.data === null &&
    classifySupabaseError(result.error) === "authorization_denied"
  ) {
    return;
  }
  if (result?.error === null) fail(failureCode);
  fail(`${failureCode}_${classifySupabaseError(result?.error)}`);
}

export function requireAuthenticatedHouseholdDenial(result, failureCode) {
  const error = result?.error;
  const classification = classifySupabaseError(error);
  const statuses = [numericStatus(error?.status), numericStatus(error?.statusCode)].filter(
    (status) => status !== null,
  );
  if (
    result?.data === null &&
    classification === "authorization_denied" &&
    (statuses.includes(403) || error?.code === "42501")
  ) {
    return;
  }
  if (result?.error === null) fail(failureCode);
  fail(`${failureCode}_${classification}`);
}

export function requireKnownExistingStorageReadDenial(result, failureCode) {
  if (
    result &&
    typeof result === "object" &&
    result.data === null &&
    classifySupabaseError(result.error) === "authorization_denied"
  ) {
    return;
  }
  const semanticCode = result?.error?.statusCode ?? result?.error?.code;
  const storageNonDisclosure =
    result?.data === null &&
    result?.error?.name === "StorageApiError" &&
    [400, 404].includes(Number(result.error.status)) &&
    ["AccessDenied", "NoSuchKey", "Unauthorized", "404"].includes(
      String(semanticCode),
    );
  if (storageNonDisclosure) return;
  if (result?.error === null) fail(failureCode);
  fail(`${failureCode}_${classifySupabaseError(result?.error)}`);
}

export async function runRecoverableDenialProbe({
  attempt,
  cleanup,
  cleanupCode,
  denialCode,
  settle = waitForRecoverySettle,
  verifyRecovered,
}) {
  let primaryError = null;
  try {
    const result = await attempt();
    requireAuthorizationDenial(result, denialCode);
  } catch (error) {
    primaryError = toSafeFailure(error, `${denialCode}_network_error`);
  }

  let cleanupError = null;
  try {
    const cleanupResult = await cleanup();
    requireSdkSuccess(cleanupResult, cleanupCode);
    assert(await verifyRecovered(), `${cleanupCode}_residual`);
    await settle();
    assert(await verifyRecovered(), `${cleanupCode}_late_residual`);
  } catch (error) {
    cleanupError = toSafeFailure(error, cleanupCode);
  }

  const failure = combineSafeFailures(primaryError, cleanupError);
  if (failure) throw failure;
}

export function safeFailureCode(error) {
  return error instanceof SafeVerificationError
    ? error.message
    : "unexpected_verification_failure";
}

export function reportVerificationFailure(error, logger = console.error) {
  logger(`${PREFIX} FAIL ${safeFailureCode(error)}`);
}

function pass(message) {
  console.log(`${PREFIX} PASS ${message}`);
}

function skip(missing) {
  console.log(
    `${PREFIX} SKIP / non-connected: required explicit cloud environment is missing (${missing.join(
      ", ",
    )}).`,
  );
}

function present(environment, name) {
  const value = environment[name];
  return typeof value === "string" && value.length > 0;
}

function normalized(environment, name) {
  return environment[name]?.trim() ?? "";
}

export function isLoopbackHostname(hostname) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value === "::1" ||
    value === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(value) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(value)
  );
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

export function isPublishableKey(value) {
  if (typeof value !== "string" || value.includes("\r") || value.includes("\n")) {
    return false;
  }
  const key = value.trim();
  if (/^sb_secret_/i.test(key)) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/i.test(key)) return true;
  return decodeJwtRole(key) === "anon";
}

export function isSecretKey(value) {
  if (typeof value !== "string" || value.includes("\r") || value.includes("\n")) {
    return false;
  }
  const key = value.trim();
  if (/^sb_secret_[A-Za-z0-9_-]{16,}$/i.test(key)) return true;
  return decodeJwtRole(key) === "service_role";
}

function validEmail(value) {
  return (
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    value.toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX)
  );
}

function parseHostedUrl(value) {
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
    (url.pathname !== "/" && url.pathname !== "") ||
    isLoopbackHostname(url.hostname)
  ) {
    return null;
  }
  return url.origin;
}

export function loadCloudSupabaseConfig(environment = process.env) {
  const explicitlyEnabled =
    normalized(environment, CLOUD_SUPABASE_ENV.enabled).toLowerCase() === "true";
  if (!explicitlyEnabled) {
    return Object.freeze({
      missing: Object.freeze([CLOUD_SUPABASE_ENV.enabled]),
      status: "skip",
    });
  }

  const missing = REQUIRED_ENV_NAMES.filter((name) => !present(environment, name));
  if (missing.length > 0) {
    return Object.freeze({ missing: Object.freeze(missing), status: "skip" });
  }

  const url = parseHostedUrl(normalized(environment, CLOUD_SUPABASE_ENV.url));
  if (!url) return Object.freeze({ reason: "unsafe_cloud_url", status: "invalid" });
  if (url !== HOMERELAY_CLOUD_PROJECT.url) {
    return Object.freeze({ reason: "wrong_cloud_project", status: "invalid" });
  }

  const publishableKey = normalized(
    environment,
    CLOUD_SUPABASE_ENV.publishableKey,
  );
  if (!isPublishableKey(publishableKey)) {
    return Object.freeze({
      reason: "publishable_key_required",
      status: "invalid",
    });
  }

  const secretKey = normalized(environment, CLOUD_SUPABASE_ENV.secretKey);
  if (!isSecretKey(secretKey)) {
    return Object.freeze({
      reason: "server_secret_key_required",
      status: "invalid",
    });
  }

  const accounts = {
    family: {
      email: normalized(environment, CLOUD_SUPABASE_ENV.familyEmail),
      password: environment[CLOUD_SUPABASE_ENV.familyPassword],
      role: "family",
    },
    foreignFamily: {
      email: normalized(environment, CLOUD_SUPABASE_ENV.foreignFamilyEmail),
      password: environment[CLOUD_SUPABASE_ENV.foreignFamilyPassword],
      role: "family",
    },
    helper: {
      email: normalized(environment, CLOUD_SUPABASE_ENV.helperEmail),
      password: environment[CLOUD_SUPABASE_ENV.helperPassword],
      role: "helper",
    },
  };
  const emails = Object.values(accounts).map(({ email }) => email.toLowerCase());
  if (!Object.values(accounts).every(({ email }) => validEmail(email))) {
    return Object.freeze({ reason: "invalid_account_email", status: "invalid" });
  }
  if (new Set(emails).size !== emails.length) {
    return Object.freeze({ reason: "accounts_must_be_distinct", status: "invalid" });
  }

  return Object.freeze({
    config: Object.freeze({
      accounts: Object.freeze({
        family: Object.freeze(accounts.family),
        foreignFamily: Object.freeze(accounts.foreignFamily),
        helper: Object.freeze(accounts.helper),
      }),
      publishableKey,
      secretKey,
      url,
    }),
    status: "ready",
  });
}

export async function bounded(
  operation,
  failureCode,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  let timer;
  const controller = new AbortController();
  const abortableOperation =
    operation && typeof operation.abortSignal === "function"
      ? operation.abortSignal(controller.signal)
      : operation;
  try {
    return await Promise.race([
      Promise.resolve(abortableOperation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new SafeVerificationError(failureCode));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof SafeVerificationError) throw error;
    fail(failureCode);
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

function createTimedFetch() {
  return (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return fetch(input, {
      ...init,
      redirect: "error",
      signal,
    });
  };
}

function createPublicClient(config) {
  return createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: createTimedFetch() },
  });
}

function createAdminClient(config) {
  return createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: createTimedFetch() },
  });
}

function createArtifactLedger(config) {
  return {
    authEmails: new Set(
      Object.values(config.accounts).map(({ email }) => email.toLowerCase()),
    ),
    authUserIds: new Set(),
    householdIds: new Set(),
    storagePaths: new Set(),
  };
}

async function verifyAdminInvitationPath(config, admin, ledger) {
  const email = `invited-${randomUUID()}${SYNTHETIC_EMAIL_SUFFIX}`;
  ledger.authEmails.add(email.toLowerCase());
  const invitedClient = createPublicClient(config);
  let primaryError = null;
  try {
    const result = await bounded(
      admin.auth.admin.generateLink({
        email,
        options: { data: { source: "homerelay-cloud-verifier" } },
        type: "invite",
      }),
      "admin_invite_check_failed",
    );
    const user = requireAdminInviteLink(result, email);
    ledger.authUserIds.add(user.id);

    const verificationResult = await bounded(
      invitedClient.auth.verifyOtp({
        token_hash: result.data.properties.hashed_token,
        type: "invite",
      }),
      "admin_invite_redemption_failed",
    );
    const verification = requireSdkSuccess(
      verificationResult,
      "admin_invite_redemption_failed",
      (data) =>
        data?.user?.id === user.id &&
        data.user.email?.toLowerCase() === email.toLowerCase() &&
        typeof data?.session?.access_token === "string",
    );
    assert(verification.user.id === user.id, "admin_invite_redemption_failed");
  } catch (error) {
    primaryError = toSafeFailure(error, "admin_invite_check_failed");
  }

  let cleanupError = null;
  try {
    invitedClient.realtime.disconnect();
    const signOutResult = await bounded(
      invitedClient.auth.signOut({ scope: "local" }),
      "admin_invite_session_cleanup_failed",
      5_000,
    );
    requireSdkSuccess(signOutResult, "admin_invite_session_cleanup_failed");
  } catch (error) {
    cleanupError = toSafeFailure(error, "admin_invite_session_cleanup_failed");
  }

  const failure = combineSafeFailures(primaryError, cleanupError);
  if (failure) throw failure;
  pass("Auth admin invite-link generation and redemption remain available");
}

async function requireEmptyCloud(admin, codePrefix) {
  const userResult = await bounded(
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
    `${codePrefix}_auth_query_failed`,
  );
  const userData = requireSdkSuccess(
    userResult,
    `${codePrefix}_auth_query_failed`,
    (data) => Array.isArray(data?.users),
  );
  assert(userData.users.length === 0, `${codePrefix}_auth_users_not_zero`);

  for (const table of PUBLIC_TABLES) {
    const result = await bounded(
      admin.from(table).select("id", { count: "exact", head: true }),
      `${codePrefix}_${table}_query_failed`,
    );
    requireSdkSuccess(
      result,
      `${codePrefix}_${table}_query_failed`,
      (data) => data === null,
    );
    assert(result.count === 0, `${codePrefix}_${table}_rows_not_zero`);
  }

  const bucketResult = await bounded(
    admin.storage.getBucket(PHOTO_BUCKET),
    `${codePrefix}_bucket_query_failed`,
  );
  const bucket = requireSdkSuccess(
    bucketResult,
    `${codePrefix}_bucket_query_failed`,
    (data) => data?.id === PHOTO_BUCKET,
  );
  assert(bucket.public === false, `${codePrefix}_bucket_not_private`);

  const objectsResult = await bounded(
    admin.storage.from(PHOTO_BUCKET).list("", {
      limit: 1_000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
    `${codePrefix}_storage_query_failed`,
  );
  const objects = requireSdkSuccess(
    objectsResult,
    `${codePrefix}_storage_query_failed`,
    Array.isArray,
  );
  assert(objects.length === 0, `${codePrefix}_storage_objects_not_zero`);
}

async function provisionSyntheticFixture(config, admin, ledger) {
  const primaryHouseholdId = randomUUID();
  const foreignHouseholdId = randomUUID();
  const familyMemberId = randomUUID();
  const helperMemberId = randomUUID();
  const foreignMemberId = randomUUID();
  ledger.householdIds.add(primaryHouseholdId);
  ledger.householdIds.add(foreignHouseholdId);

  const users = {};
  for (const [label, account] of Object.entries(config.accounts)) {
    const result = await bounded(
      admin.auth.admin.createUser({
        email: account.email,
        email_confirm: true,
        password: account.password,
      }),
      `${label}_auth_create_failed`,
    );
    const data = requireSdkSuccess(
      result,
      `${label}_auth_create_failed`,
      (value) => value?.user?.email?.toLowerCase() === account.email.toLowerCase(),
    );
    users[label] = data.user;
    ledger.authUserIds.add(data.user.id);
  }

  const householdsResult = await bounded(
    admin
      .from("households")
      .insert([
        { id: primaryHouseholdId, name: "Synthetic HomeRelay household A" },
        { id: foreignHouseholdId, name: "Synthetic HomeRelay household B" },
      ])
      .select("id"),
    "synthetic_household_create_failed",
  );
  requireSdkSuccess(
    householdsResult,
    "synthetic_household_create_failed",
    (data) => Array.isArray(data) && data.length === 2,
  );

  const membersResult = await bounded(
    admin
      .from("members")
      .insert([
        {
          auth_user_id: users.family.id,
          display_name: "Synthetic family A",
          household_id: primaryHouseholdId,
          id: familyMemberId,
          role: "family",
        },
        {
          auth_user_id: users.helper.id,
          display_name: "Synthetic helper A",
          household_id: primaryHouseholdId,
          id: helperMemberId,
          role: "helper",
        },
        {
          auth_user_id: users.foreignFamily.id,
          display_name: "Synthetic family B",
          household_id: foreignHouseholdId,
          id: foreignMemberId,
          role: "family",
        },
      ])
      .select("id"),
    "synthetic_member_create_failed",
  );
  requireSdkSuccess(
    membersResult,
    "synthetic_member_create_failed",
    (data) => Array.isArray(data) && data.length === 3,
  );
  pass("Provisioned isolated .test Auth users and synthetic household memberships");
}

async function signIn(config, account, label) {
  const client = createPublicClient(config);
  try {
    const { data, error } = await bounded(
      client.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      }),
      `${label}_sign_in_failed`,
    );
    assert(!error && data.user && data.session, `${label}_sign_in_failed`);

    await bounded(
      client.realtime.setAuth(data.session.access_token),
      `${label}_realtime_auth_failed`,
    );

    const { data: member, error: memberError } = await bounded(
      client
        .from("members")
        .select("id, household_id, auth_user_id, role")
        .eq("auth_user_id", data.user.id)
        .single(),
      `${label}_membership_lookup_failed`,
    );
    assert(!memberError && member, `${label}_membership_lookup_failed`);
    assert(member.auth_user_id === data.user.id, `${label}_membership_mismatch`);
    assert(member.role === account.role, `${label}_role_mismatch`);
    assert(
      typeof member.id === "string" && typeof member.household_id === "string",
      `${label}_membership_invalid`,
    );

    return { client, member, userId: data.user.id };
  } catch (error) {
    let closeError = null;
    try {
      await closeClients({ failed: { client } });
    } catch (cleanupError) {
      closeError = toSafeFailure(cleanupError, "local_session_cleanup_failed");
    }
    throw combineSafeFailures(
      toSafeFailure(error, `${label}_sign_in_failed`),
      closeError,
    );
  }
}

async function verifyInvitedAccounts(config) {
  const results = await Promise.allSettled([
    signIn(config, config.accounts.family, "family"),
    signIn(config, config.accounts.helper, "helper"),
    signIn(config, config.accounts.foreignFamily, "foreign_family"),
  ]);
  const successfulAccounts = Object.fromEntries(
    results
      .filter((result) => result.status === "fulfilled")
      .map((result, index) => [String(index), result.value]),
  );
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected) {
    let closeError = null;
    try {
      await closeClients(successfulAccounts);
    } catch (cleanupError) {
      closeError = toSafeFailure(cleanupError, "local_session_cleanup_failed");
    }
    throw combineSafeFailures(
      toSafeFailure(rejected.reason, "account_verification_failed"),
      closeError,
    );
  }
  const [family, helper, foreignFamily] = results.map((result) => result.value);

  assert(family.userId !== helper.userId, "same_household_accounts_not_distinct");
  assert(
    family.userId !== foreignFamily.userId && helper.userId !== foreignFamily.userId,
    "foreign_account_not_distinct",
  );
  assert(
    family.member.household_id === helper.member.household_id,
    "family_helper_household_mismatch",
  );
  assert(
    foreignFamily.member.household_id !== family.member.household_id,
    "foreign_family_household_not_distinct",
  );
  pass("Auth sign-in and expected family/helper household roles");
  return { family, foreignFamily, helper };
}

async function requireActiveSyntheticSession(account, label) {
  const userResult = await bounded(
    account.client.auth.getUser(),
    `${label}_session_health_check_failed`,
  );
  const userData = requireSdkSuccess(
    userResult,
    `${label}_session_health_check_failed`,
    (value) => value?.user?.id === account.userId,
  );
  assert(
    userData.user.id === account.userId,
    `${label}_session_health_check_failed`,
  );

  const memberResult = await bounded(
    account.client
      .from("members")
      .select("id, household_id, auth_user_id, role")
      .eq("auth_user_id", account.userId)
      .single(),
    `${label}_membership_health_check_failed`,
  );
  const member = requireSdkSuccess(
    memberResult,
    `${label}_membership_health_check_failed`,
    Boolean,
  );
  assert(
    member.id === account.member.id &&
      member.household_id === account.member.household_id &&
      member.auth_user_id === account.userId &&
      member.role === account.member.role,
    `${label}_membership_health_check_failed`,
  );
}

async function verifyInvitationOnly(config, ledger) {
  const client = createPublicClient(config);
  const email = `uninvited-${randomUUID()}${SYNTHETIC_EMAIL_SUFFIX}`;
  const password = `${randomBytes(32).toString("base64url")}Aa1!`;
  ledger.authEmails.add(email.toLowerCase());
  let primaryError = null;
  try {
    const result = await bounded(
      client.auth.signUp({ email, password }),
      "uninvited_signup_check_failed",
    );
    const { data, error } = result;
    if (data?.user?.id) ledger.authUserIds.add(data.user.id);
    assert(
      error?.code === "signup_disabled" && !data.user && !data.session,
      "uninvited_signup_not_rejected",
    );
  } catch (error) {
    primaryError = toSafeFailure(error, "uninvited_signup_check_failed");
  }

  let cleanupError = null;
  try {
    client.realtime.disconnect();
  } catch (error) {
    cleanupError = toSafeFailure(error, "uninvited_session_cleanup_failed");
  }
  try {
    const signOutResult = await bounded(
      client.auth.signOut({ scope: "local" }),
      "uninvited_session_cleanup_failed",
      5_000,
    );
    requireSdkSuccess(signOutResult, "uninvited_session_cleanup_failed");
  } catch (error) {
    cleanupError = combineSafeFailures(
      cleanupError,
      toSafeFailure(error, "uninvited_session_cleanup_failed"),
    );
  }

  const failure = combineSafeFailures(primaryError, cleanupError);
  if (failure) throw failure;
  pass("Auth rejects an uninvited synthetic signup");
}

function createEventProbe() {
  const events = [];
  const waiters = new Set();
  return {
    events,
    push(payload) {
      events.push(payload);
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(payload)) continue;
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(payload);
      }
    },
    waitFor(predicate, failureCode) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new SafeVerificationError(failureCode));
          }, EVENT_TIMEOUT_MS),
        };
        waiters.add(waiter);
      });
    },
  };
}

function subscribeChannel(channel, failureCode) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new SafeVerificationError(failureCode));
    }, SUBSCRIBE_TIMEOUT_MS);

    try {
      channel.subscribe((status) => {
        if (settled) return;
        if (status === "SUBSCRIBED") {
          settled = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (["CHANNEL_ERROR", "CLOSED", "TIMED_OUT"].includes(status)) {
          settled = true;
          clearTimeout(timer);
          reject(new SafeVerificationError(failureCode));
        }
      });
    } catch {
      settled = true;
      clearTimeout(timer);
      reject(new SafeVerificationError(failureCode));
    }
  });
}

async function cleanupChannels(channels) {
  const results = await Promise.all(
    channels.map(({ channel, client }) =>
      bounded(client.removeChannel(channel), "realtime_channel_cleanup_failed", 5_000),
    ),
  );
  assert(results.every((result) => result === "ok"), "realtime_channel_cleanup_failed");
}

function splitStoragePath(path) {
  const separator = path.lastIndexOf("/");
  assert(separator > 0 && separator < path.length - 1, "invalid_synthetic_storage_path");
  return { folder: path.slice(0, separator), name: path.slice(separator + 1) };
}

async function storageObjectAbsent(admin, path, failureCode) {
  const { folder, name } = splitStoragePath(path);
  const result = await bounded(
    admin.storage.from(PHOTO_BUCKET).list(folder, {
      limit: 100,
      offset: 0,
      search: name,
      sortBy: { column: "name", order: "asc" },
    }),
    failureCode,
  );
  const objects = requireSdkSuccess(result, failureCode, Array.isArray);
  return !objects.some((object) => object.name === name);
}

async function storageObjectMatches(admin, path, expectedBytes, failureCode) {
  const result = await bounded(
    admin.storage.from(PHOTO_BUCKET).download(path),
    failureCode,
  );
  const object = requireSdkSuccess(
    result,
    failureCode,
    (data) => typeof data?.arrayBuffer === "function",
  );
  const actualHash = createHash("sha256")
    .update(new Uint8Array(await object.arrayBuffer()))
    .digest("hex");
  const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");
  return actualHash === expectedHash;
}

async function entryState(admin, entryId, failureCode) {
  const result = await bounded(
    admin
      .from("entries")
      .select("id, condition_summary")
      .eq("id", entryId)
      .maybeSingle(),
    failureCode,
  );
  return requireSdkSuccess(result, failureCode);
}

async function cleanupStorageArtifacts(admin, ledger) {
  const paths = [...ledger.storagePaths];
  if (paths.length === 0) return;
  const removeResult = await bounded(
    admin.storage.from(PHOTO_BUCKET).remove(paths),
    "storage_cleanup_failed",
  );
  requireSdkSuccess(removeResult, "storage_cleanup_failed", Array.isArray);
  for (const path of paths) {
    assert(
      await storageObjectAbsent(
        admin,
        path,
        "storage_cleanup_verification_failed",
      ),
      "storage_cleanup_residual",
    );
  }
}

async function cleanupDataArtifacts(admin, ledger) {
  const householdIds = [...ledger.householdIds];
  if (householdIds.length === 0) return;
  const cleanupOrder = [
    "acknowledgements",
    "needed_items",
    "entries",
    "members",
    "households",
  ];
  const failures = [];

  // Delete child rows explicitly before parents. This avoids relying on a
  // cascade order where member foreign keys include ON DELETE RESTRICT.
  for (const table of cleanupOrder) {
    const column = table === "households" ? "id" : "household_id";
    try {
      const result = await bounded(
        admin.from(table).delete().in(column, householdIds).select("id"),
        `data_cleanup_${table}_failed`,
      );
      requireSdkSuccess(result, `data_cleanup_${table}_failed`, Array.isArray);
    } catch (error) {
      failures.push(toSafeFailure(error, `data_cleanup_${table}_failed`));
    }
  }

  for (const table of cleanupOrder) {
    const column = table === "households" ? "id" : "household_id";
    try {
      const result = await bounded(
        admin
          .from(table)
          .select("id", { count: "exact", head: true })
          .in(column, householdIds),
        `data_cleanup_${table}_verification_failed`,
      );
      requireSdkSuccess(
        result,
        `data_cleanup_${table}_verification_failed`,
        (data) => data === null,
      );
      assert(result.count === 0, `data_cleanup_${table}_residual`);
    } catch (error) {
      failures.push(
        toSafeFailure(error, `data_cleanup_${table}_verification_failed`),
      );
    }
  }

  const failure = combineSafeFailures(...failures);
  if (failure) throw failure;
}

async function cleanupAuthArtifacts(admin, ledger) {
  const listResult = await bounded(
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
    "auth_cleanup_lookup_failed",
  );
  const listData = requireSdkSuccess(
    listResult,
    "auth_cleanup_lookup_failed",
    (data) => Array.isArray(data?.users),
  );
  const testUsers = listData.users.filter(
    (user) =>
      ledger.authUserIds.has(user.id) ||
      ledger.authEmails.has(user.email?.toLowerCase() ?? ""),
  );
  for (const user of testUsers) {
    const deleteResult = await bounded(
      admin.auth.admin.deleteUser(user.id),
      "auth_cleanup_failed",
    );
    requireSdkSuccess(deleteResult, "auth_cleanup_failed");
  }
}

export async function executeStrictCleanup({
  cleanupAuth,
  cleanupData,
  cleanupStorage,
  settle = waitForFinalCleanupSettle,
  verifyEmpty,
}) {
  const failures = [];
  const runStage = async (operation, fallbackCode) => {
    try {
      await operation();
      return true;
    } catch (error) {
      failures.push(toSafeFailure(error, fallbackCode));
      return false;
    }
  };

  await runStage(cleanupStorage, "storage_cleanup_failed");
  const dataClean = await runStage(cleanupData, "data_cleanup_failed");
  if (dataClean) {
    await runStage(cleanupAuth, "auth_cleanup_failed");
  }
  await runStage(verifyEmpty, "post_cleanup_residual_detected");
  try {
    await settle();
  } catch (error) {
    failures.push(toSafeFailure(error, "post_cleanup_settle_failed"));
  }
  await runStage(verifyEmpty, "post_cleanup_late_residual_detected");

  const failure = combineSafeFailures(...failures);
  if (failure) throw failure;
}

async function cleanupArtifacts(admin, ledger) {
  await executeStrictCleanup({
    cleanupAuth: () => cleanupAuthArtifacts(admin, ledger),
    cleanupData: () => cleanupDataArtifacts(admin, ledger),
    cleanupStorage: () => cleanupStorageArtifacts(admin, ledger),
    verifyEmpty: () => requireEmptyCloud(admin, "post_cleanup"),
  });
  pass("Cleanup confirmed: Auth 0, public rows 0, Storage objects 0");
}

async function verifyPrivateShareAndRealtime(accounts, admin, ledger) {
  const { family, foreignFamily, helper } = accounts;
  const runId = randomUUID();
  const photoPath = `${helper.member.household_id}/${helper.member.id}/${runId}.jpg`;
  const deleteProbeId = randomUUID();
  const deleteProbePath = `${helper.member.household_id}/${helper.member.id}/${deleteProbeId}.jpg`;
  const foreignInsertId = randomUUID();
  const foreignInsertPath = `${helper.member.household_id}/${helper.member.id}/${foreignInsertId}.jpg`;
  const photoSha256 = createHash("sha256")
    .update(SYNTHETIC_JPEG)
    .digest("hex");
  const summary = `Synthetic cloud handoff ${runId}`;
  const itemName = `Synthetic cloud item ${runId}`;
  const familyEvents = createEventProbe();
  const foreignEvents = createEventProbe();
  const householdFilter = `household_id=eq.${helper.member.household_id}`;
  const familyChannel = family.client
    .channel(`cloud-family-${runId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        filter: householdFilter,
        schema: "public",
        table: "entries",
      },
      (payload) => familyEvents.push(payload),
    );
  const foreignChannel = foreignFamily.client
    .channel(`cloud-foreign-${runId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        filter: householdFilter,
        schema: "public",
        table: "entries",
      },
      (payload) => foreignEvents.push(payload),
    );
  const channels = [
    { channel: familyChannel, client: family.client },
    { channel: foreignChannel, client: foreignFamily.client },
  ];
  ledger.storagePaths.add(photoPath);
  ledger.storagePaths.add(deleteProbePath);
  ledger.storagePaths.add(foreignInsertPath);

  let primaryError = null;
  try {
    await Promise.all([
      requireActiveSyntheticSession(family, "family"),
      requireActiveSyntheticSession(helper, "helper"),
      requireActiveSyntheticSession(foreignFamily, "foreign_family"),
    ]);

    await Promise.all([
      subscribeChannel(familyChannel, "family_realtime_subscribe_failed"),
      subscribeChannel(foreignChannel, "foreign_realtime_subscribe_failed"),
    ]);

    const uploadResult = await bounded(
      helper.client.storage.from(PHOTO_BUCKET).upload(photoPath, SYNTHETIC_JPEG, {
        cacheControl: "0",
        contentType: "image/jpeg",
        upsert: false,
      }),
      "helper_photo_upload_failed",
    );
    requireSdkSuccess(uploadResult, "helper_photo_upload_failed");

    await runRecoverableDenialProbe({
      attempt: () =>
        bounded(
        foreignFamily.client.storage
          .from(PHOTO_BUCKET)
          .upload(foreignInsertPath, SYNTHETIC_JPEG, {
            cacheControl: "0",
            contentType: "image/jpeg",
            upsert: false,
          }),
        "foreign_storage_insert_denial_check_failed",
      ),
      cleanup: () =>
        bounded(
          admin.storage.from(PHOTO_BUCKET).remove([foreignInsertPath]),
          "foreign_storage_insert_cleanup_failed",
        ),
      cleanupCode: "foreign_storage_insert_cleanup_failed",
      denialCode: "foreign_household_storage_insert_not_denied",
      verifyRecovered: () =>
        storageObjectAbsent(
          admin,
          foreignInsertPath,
          "foreign_storage_insert_cleanup_verification_failed",
        ),
    });

    await runRecoverableDenialProbe({
      attempt: () =>
        bounded(
        foreignFamily.client.storage
          .from(PHOTO_BUCKET)
          .update(photoPath, SYNTHETIC_UPDATED_JPEG, {
            cacheControl: "0",
            contentType: "image/jpeg",
            upsert: false,
          }),
        "foreign_storage_update_denial_check_failed",
      ),
      cleanup: () =>
        bounded(
          admin.storage.from(PHOTO_BUCKET).upload(photoPath, SYNTHETIC_JPEG, {
            cacheControl: "0",
            contentType: "image/jpeg",
            upsert: true,
          }),
          "foreign_storage_update_cleanup_failed",
        ),
      cleanupCode: "foreign_storage_update_cleanup_failed",
      denialCode: "foreign_household_storage_update_not_denied",
      verifyRecovered: () =>
        storageObjectMatches(
          admin,
          photoPath,
          SYNTHETIC_JPEG,
          "foreign_storage_update_cleanup_verification_failed",
        ),
    });

    const deleteProbeUploadResult = await bounded(
      helper.client.storage.from(PHOTO_BUCKET).upload(deleteProbePath, SYNTHETIC_JPEG, {
        cacheControl: "0",
        contentType: "image/jpeg",
        upsert: false,
      }),
      "delete_probe_upload_failed",
    );
    requireSdkSuccess(deleteProbeUploadResult, "delete_probe_upload_failed");

    const foreignDeleteResult = await bounded(
        foreignFamily.client.storage.from(PHOTO_BUCKET).remove([deleteProbePath]),
        "foreign_storage_delete_denial_check_failed",
      );
    if (foreignDeleteResult.error !== null) {
      requireAuthorizationDenial(
        foreignDeleteResult,
        "foreign_household_storage_delete_not_denied",
      );
    } else {
      requireSdkSuccess(
        foreignDeleteResult,
        "foreign_household_storage_delete_not_denied",
        (data) => Array.isArray(data) && data.length === 0,
      );
    }

    const retainedDeleteResult = await bounded(
        helper.client.storage.from(PHOTO_BUCKET).download(deleteProbePath),
        "delete_probe_retention_check_failed",
      );
    requireSdkSuccess(
      retainedDeleteResult,
      "foreign_household_storage_delete_succeeded",
      (data) => data?.size === SYNTHETIC_JPEG.byteLength,
    );

    const familyPhotoResult = await bounded(
      family.client.storage.from(PHOTO_BUCKET).download(photoPath),
      "same_household_photo_read_failed",
    );
    requireSdkSuccess(
      familyPhotoResult,
      "same_household_photo_read_failed",
      (data) => data?.size === SYNTHETIC_JPEG.byteLength,
    );

    const foreignPhotoResult = await bounded(
      foreignFamily.client.storage.from(PHOTO_BUCKET).download(photoPath),
      "foreign_photo_denial_check_failed",
    );
    requireKnownExistingStorageReadDenial(
      foreignPhotoResult,
      "foreign_household_photo_visible",
    );
    pass("Private Storage household-scoped SELECT/INSERT/UPDATE/DELETE policies");

    const shareResult = await bounded(
      helper.client.rpc("share_handoff", {
        p_completed_summary: "Synthetic cloud verification completed",
        p_condition_summary: summary,
        p_idempotency_key: runId,
        p_needed_items: [itemName],
        p_next_request: "Review this synthetic cloud verification entry",
        p_photo_alt: "Synthetic HomeRelay cloud verification photo",
        p_photo_path: photoPath,
        p_photo_sha256: photoSha256,
      }),
      "confirmed_share_failed",
    );
    const entryId = requireSdkSuccess(
      shareResult,
      "confirmed_share_failed",
      (data) => typeof data === "string",
    );

    const sameHouseholdResult = await bounded(
      family.client
        .from("entries")
        .select("id, household_id, author_member_id, status, condition_summary, photo_path")
        .eq("id", entryId)
        .single(),
      "same_household_entry_read_failed",
    );
    const sameHouseholdEntry = requireSdkSuccess(
      sameHouseholdResult,
      "same_household_entry_read_failed",
      (data) => Boolean(data),
    );
    assert(
      sameHouseholdEntry.id === entryId &&
        sameHouseholdEntry.household_id === family.member.household_id &&
        sameHouseholdEntry.author_member_id === helper.member.id &&
        sameHouseholdEntry.status === "confirmed" &&
        sameHouseholdEntry.condition_summary === summary &&
        sameHouseholdEntry.photo_path === photoPath,
      "confirmed_share_contract_mismatch",
    );

    const neededItemResult = await bounded(
      family.client
        .from("needed_items")
        .select("id, household_id, entry_id, name, status")
        .eq("entry_id", entryId)
        .single(),
      "same_household_needed_item_read_failed",
    );
    const neededItem = requireSdkSuccess(
      neededItemResult,
      "same_household_needed_item_read_failed",
      (data) => Boolean(data),
    );
    assert(
      neededItem.household_id === family.member.household_id &&
        neededItem.entry_id === entryId &&
        neededItem.name === itemName &&
        neededItem.status === "needed",
      "confirmed_share_needed_item_contract_mismatch",
    );

    const foreignReadResult = await bounded(
      foreignFamily.client.from("entries").select("id").eq("id", entryId),
      "foreign_entry_denial_check_failed",
    );
    requireSdkSuccess(
      foreignReadResult,
      "foreign_household_entry_visible",
      (data) => Array.isArray(data) && data.length === 0,
    );

    const foreignDirectInsertId = randomUUID();
    await runRecoverableDenialProbe({
      attempt: () =>
        bounded(
          foreignFamily.client
            .from("entries")
            .insert({
              author_member_id: helper.member.id,
              completed_summary: "",
              condition_summary: "Synthetic forbidden foreign insert",
              household_id: helper.member.household_id,
              id: foreignDirectInsertId,
              idempotency_key: foreignDirectInsertId,
              next_request: "",
              payload_hash: "synthetic-foreign-insert",
              photo_alt: "Synthetic forbidden foreign insert photo",
              photo_path: `${helper.member.household_id}/${helper.member.id}/${foreignDirectInsertId}.jpg`,
              photo_sha256: photoSha256,
            })
            .select("id"),
          "foreign_direct_insert_denial_check_failed",
        ),
      cleanup: () =>
        bounded(
          admin.from("entries").delete().eq("id", foreignDirectInsertId).select("id"),
          "foreign_direct_insert_cleanup_failed",
        ),
      cleanupCode: "foreign_direct_insert_cleanup_failed",
      denialCode: "foreign_household_direct_insert_not_denied",
      verifyRecovered: async () =>
        (await entryState(
          admin,
          foreignDirectInsertId,
          "foreign_direct_insert_cleanup_verification_failed",
        )) === null,
    });

    const foreignUpdateSummary = `Synthetic forbidden foreign update ${runId}`;
    await runRecoverableDenialProbe({
      attempt: () =>
        bounded(
          foreignFamily.client
            .from("entries")
            .update({ condition_summary: foreignUpdateSummary })
            .eq("id", entryId)
            .select("id"),
          "foreign_direct_update_denial_check_failed",
        ),
      cleanup: () =>
        bounded(
          admin
            .from("entries")
            .update({ condition_summary: summary })
            .eq("id", entryId)
            .select("id"),
          "foreign_direct_update_cleanup_failed",
        ),
      cleanupCode: "foreign_direct_update_cleanup_failed",
      denialCode: "foreign_household_direct_update_not_denied",
      verifyRecovered: async () =>
        (
          await entryState(
            admin,
            entryId,
            "foreign_direct_update_cleanup_verification_failed",
          )
        )?.condition_summary === summary,
    });

    await requireActiveSyntheticSession(
      foreignFamily,
      "foreign_family_before_preclaim_rpc",
    );
    const foreignPreClaimRpcProbes = [
      ["acknowledge_entry", { p_entry_id: entryId }],
      ["claim_entry", { p_entry_id: entryId }],
      ["claim_needed_item", { p_item_id: neededItem.id }],
    ];
    for (const [functionName, args] of foreignPreClaimRpcProbes) {
      const foreignMutationResult = await bounded(
        foreignFamily.client.rpc(functionName, args),
        `foreign_${functionName}_denial_check_failed`,
      );
      requireAuthenticatedHouseholdDenial(
        foreignMutationResult,
        `foreign_household_${functionName}_not_denied`,
      );
    }
    await requireActiveSyntheticSession(
      foreignFamily,
      "foreign_family_after_preclaim_rpc",
    );

    await requireActiveSyntheticSession(family, "family_before_claim_rpc");
    const sameHouseholdClaimRpcProbes = [
      ["acknowledge_entry", { p_entry_id: entryId }],
      ["claim_entry", { p_entry_id: entryId }],
      ["claim_needed_item", { p_item_id: neededItem.id }],
    ];
    for (const [functionName, args] of sameHouseholdClaimRpcProbes) {
      const sameHouseholdMutation = await bounded(
        family.client.rpc(functionName, args),
        `same_household_${functionName}_failed`,
      );
      requireSdkSuccess(
        sameHouseholdMutation,
        `same_household_${functionName}_failed`,
        (data) => data === true,
      );
    }

    await requireActiveSyntheticSession(
      foreignFamily,
      "foreign_family_before_complete_rpc",
    );
    const foreignCompleteRpcProbes = [
      ["complete_entry", { p_entry_id: entryId }],
      ["complete_needed_item", { p_item_id: neededItem.id }],
    ];
    for (const [functionName, args] of foreignCompleteRpcProbes) {
      const foreignMutationResult = await bounded(
        foreignFamily.client.rpc(functionName, args),
        `foreign_${functionName}_denial_check_failed`,
      );
      requireAuthenticatedHouseholdDenial(
        foreignMutationResult,
        `foreign_household_${functionName}_not_denied`,
      );
    }
    await requireActiveSyntheticSession(
      foreignFamily,
      "foreign_family_after_complete_rpc",
    );

    const sameHouseholdCompleteRpcProbes = [
      ["complete_entry", { p_entry_id: entryId }],
      ["complete_needed_item", { p_item_id: neededItem.id }],
    ];
    for (const [functionName, args] of sameHouseholdCompleteRpcProbes) {
      const sameHouseholdMutation = await bounded(
        family.client.rpc(functionName, args),
        `same_household_${functionName}_failed`,
      );
      requireSdkSuccess(
        sameHouseholdMutation,
        `same_household_${functionName}_failed`,
        (data) => data === true,
      );
    }

    const [finalEntryResult, finalItemResult, acknowledgementResult] =
      await Promise.all([
        bounded(
          family.client
            .from("entries")
            .select("status, claimed_by_member_id")
            .eq("id", entryId)
            .single(),
          "same_household_entry_transition_read_failed",
        ),
        bounded(
          family.client
            .from("needed_items")
            .select("status, claimed_by_member_id, purchased_at")
            .eq("id", neededItem.id)
            .single(),
          "same_household_item_transition_read_failed",
        ),
        bounded(
          family.client
            .from("acknowledgements")
            .select("action, member_id")
            .eq("entry_id", entryId),
          "same_household_acknowledgement_read_failed",
        ),
      ]);
    const finalEntry = requireSdkSuccess(
      finalEntryResult,
      "same_household_entry_transition_read_failed",
      Boolean,
    );
    const finalItem = requireSdkSuccess(
      finalItemResult,
      "same_household_item_transition_read_failed",
      Boolean,
    );
    const acknowledgements = requireSdkSuccess(
      acknowledgementResult,
      "same_household_acknowledgement_read_failed",
      Array.isArray,
    );
    const actions = new Set(acknowledgements.map(({ action }) => action));
    assert(
      finalEntry.status === "done" &&
        finalEntry.claimed_by_member_id === family.member.id &&
        finalItem.status === "purchased" &&
        finalItem.claimed_by_member_id === family.member.id &&
        typeof finalItem.purchased_at === "string" &&
        ["confirmed", "claimed", "done"].every((action) => actions.has(action)) &&
        acknowledgements.every(({ member_id }) => member_id === family.member.id),
      "same_household_action_transition_contract_mismatch",
    );
    pass(
      "Confirmed share, five same-household actions, and foreign SELECT/INSERT/UPDATE/guarded-RPC denial",
    );

    const familyEvent = await familyEvents.waitFor(
      (payload) => payload.eventType === "INSERT" && payload.new?.id === entryId,
      "same_household_realtime_event_missing",
    );
    assert(
      familyEvent.new?.household_id === family.member.household_id,
      "same_household_realtime_payload_mismatch",
    );
    await new Promise((resolve) => setTimeout(resolve, NEGATIVE_OBSERVATION_MS));
    assert(
      !foreignEvents.events.some(
        (payload) => payload.new?.id === entryId || payload.old?.id === entryId,
      ),
      "foreign_household_realtime_event_received",
    );
    pass("Realtime delivers to the same household without foreign delivery");
  } catch (error) {
    primaryError = toSafeFailure(error, "private_share_realtime_verification_failed");
  }

  let channelCleanupError = null;
  try {
    await cleanupChannels(channels);
  } catch (error) {
    channelCleanupError = toSafeFailure(error, "realtime_channel_cleanup_failed");
  }

  const failure = combineSafeFailures(primaryError, channelCleanupError);
  if (failure) throw failure;
}

async function closeClients(accounts) {
  const failures = [];
  for (const account of Object.values(accounts)) {
    try {
      account.client.realtime.disconnect();
      const result = await bounded(
        account.client.auth.signOut({ scope: "local" }),
        "local_session_cleanup_failed",
        5_000,
      );
      requireSdkSuccess(result, "local_session_cleanup_failed");
    } catch (error) {
      failures.push(toSafeFailure(error, "local_session_cleanup_failed"));
    }
  }
  const failure = combineSafeFailures(...failures);
  if (failure) throw failure;
}

export async function runCloudSupabaseVerification(environment = process.env) {
  const loaded = loadCloudSupabaseConfig(environment);
  if (loaded.status === "skip") {
    skip(loaded.missing);
    return Object.freeze({ status: "skipped" });
  }
  if (loaded.status === "invalid") fail(loaded.reason);

  const admin = createAdminClient(loaded.config);
  const ledger = createArtifactLedger(loaded.config);
  let accounts = {};
  let cleanupAuthorized = false;
  const verificationErrors = [];
  const rememberFailure = (error, fallbackCode) => {
    verificationErrors.push(toSafeFailure(error, fallbackCode));
  };
  try {
    await requireEmptyCloud(admin, "preflight");
    cleanupAuthorized = true;
    pass("Preflight confirmed: dedicated project has Auth 0, public rows 0, Storage objects 0");
    try {
      await verifyInvitationOnly(loaded.config, ledger);
    } catch (error) {
      rememberFailure(error, "uninvited_signup_check_failed");
    }
    await verifyAdminInvitationPath(loaded.config, admin, ledger);
    await provisionSyntheticFixture(loaded.config, admin, ledger);
    accounts = await verifyInvitedAccounts(loaded.config);
    await verifyPrivateShareAndRealtime(accounts, admin, ledger);
  } catch (error) {
    rememberFailure(error, "unexpected_verification_failure");
  } finally {
    try {
      await closeClients(accounts);
    } catch (error) {
      rememberFailure(error, "local_session_cleanup_failed");
    }

    if (cleanupAuthorized) {
      try {
        await cleanupArtifacts(admin, ledger);
      } catch (error) {
        rememberFailure(error, "cleanup_failed");
      }
    }
    try {
      admin.realtime.disconnect();
    } catch (error) {
      rememberFailure(error, "admin_realtime_cleanup_failed");
    }
  }
  if (verificationErrors.length > 0) {
    throw combineSafeFailures(...verificationErrors);
  }
  return Object.freeze({ status: "verified" });
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
  runCloudSupabaseVerification().catch((error) => {
    reportVerificationFailure(error);
    process.exitCode = 1;
  });
}
