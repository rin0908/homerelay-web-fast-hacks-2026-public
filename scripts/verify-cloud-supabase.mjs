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
  url: "HOMERELAY_CLOUD_SUPABASE_URL",
});

const PHOTO_BUCKET = "handoff-photos";
const REQUEST_TIMEOUT_MS = 20_000;
const SUBSCRIBE_TIMEOUT_MS = 20_000;
const EVENT_TIMEOUT_MS = 35_000;
const NEGATIVE_OBSERVATION_MS = 2_000;
const PREFIX = "[verify-cloud-supabase]";
const SYNTHETIC_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const REQUIRED_ENV_NAMES = Object.freeze([
  CLOUD_SUPABASE_ENV.url,
  CLOUD_SUPABASE_ENV.publishableKey,
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

function fail(code) {
  throw new SafeVerificationError(code);
}

function assert(condition, code) {
  if (!condition) fail(code);
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

function validEmail(value) {
  return (
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
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
      url,
    }),
    status: "ready",
  });
}

async function bounded(operation, failureCode, timeoutMs = REQUEST_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new SafeVerificationError(failureCode)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof SafeVerificationError) throw error;
    fail(failureCode);
  } finally {
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
    await closeClients({ failed: { client } });
    throw error;
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
    await closeClients(successfulAccounts);
    throw rejected.reason;
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

async function verifyInvitationOnly(config) {
  const client = createPublicClient(config);
  const email = `uninvited-${randomUUID()}@example.com`;
  const password = `${randomBytes(32).toString("base64url")}Aa1!`;
  try {
    const { data, error } = await bounded(
      client.auth.signUp({ email, password }),
      "uninvited_signup_check_failed",
    );
    assert(
      error?.code === "signup_disabled" && !data.user && !data.session,
      "uninvited_signup_not_rejected",
    );
    pass("Auth rejects an uninvited synthetic signup");
  } finally {
    client.realtime.disconnect();
    try {
      await bounded(
        client.auth.signOut({ scope: "local" }),
        "uninvited_session_cleanup_failed",
        5_000,
      );
    } catch {
      // A disabled signup has no session; unexpected local sessions are best-effort closed.
    }
  }
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
  await Promise.allSettled(
    channels.map(({ channel, client }) =>
      bounded(client.removeChannel(channel), "realtime_channel_cleanup_failed", 5_000),
    ),
  );
}

async function cleanupUnreferencedUpload(helper, photoPath) {
  const { data, error } = await bounded(
    helper.client.storage.from(PHOTO_BUCKET).remove([photoPath]),
    "unreferenced_photo_cleanup_failed",
  );
  assert(!error && Array.isArray(data) && data.length > 0, "unreferenced_photo_cleanup_failed");
}

async function verifyPrivateShareAndRealtime(accounts) {
  const { family, foreignFamily, helper } = accounts;
  const runId = randomUUID();
  const photoPath = `${helper.member.household_id}/${helper.member.id}/${runId}.jpg`;
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
  let uploaded = false;
  let shareAttempted = false;

  try {
    await Promise.all([
      subscribeChannel(familyChannel, "family_realtime_subscribe_failed"),
      subscribeChannel(foreignChannel, "foreign_realtime_subscribe_failed"),
    ]);

    const { error: uploadError } = await bounded(
      helper.client.storage.from(PHOTO_BUCKET).upload(photoPath, SYNTHETIC_JPEG, {
        cacheControl: "0",
        contentType: "image/jpeg",
        upsert: false,
      }),
      "helper_photo_upload_failed",
    );
    assert(!uploadError, "helper_photo_upload_failed");
    uploaded = true;

    const { data: familyPhoto, error: familyPhotoError } = await bounded(
      family.client.storage.from(PHOTO_BUCKET).download(photoPath),
      "same_household_photo_read_failed",
    );
    assert(
      !familyPhotoError && familyPhoto?.size === SYNTHETIC_JPEG.byteLength,
      "same_household_photo_read_failed",
    );

    const { data: foreignPhoto, error: foreignPhotoError } = await bounded(
      foreignFamily.client.storage.from(PHOTO_BUCKET).download(photoPath),
      "foreign_photo_denial_check_failed",
    );
    assert(
      foreignPhotoError && foreignPhoto === null,
      "foreign_household_photo_visible",
    );
    pass("Private Storage upload and household-scoped read policies");

    shareAttempted = true;
    const { data: entryId, error: shareError } = await bounded(
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
    assert(!shareError && typeof entryId === "string", "confirmed_share_failed");

    const { data: sameHouseholdEntry, error: sameHouseholdError } = await bounded(
      family.client
        .from("entries")
        .select("id, household_id, author_member_id, status, condition_summary, photo_path")
        .eq("id", entryId)
        .single(),
      "same_household_entry_read_failed",
    );
    assert(!sameHouseholdError && sameHouseholdEntry, "same_household_entry_read_failed");
    assert(
      sameHouseholdEntry.id === entryId &&
        sameHouseholdEntry.household_id === family.member.household_id &&
        sameHouseholdEntry.author_member_id === helper.member.id &&
        sameHouseholdEntry.status === "confirmed" &&
        sameHouseholdEntry.condition_summary === summary &&
        sameHouseholdEntry.photo_path === photoPath,
      "confirmed_share_contract_mismatch",
    );

    const { data: foreignRows, error: foreignReadError } = await bounded(
      foreignFamily.client.from("entries").select("id").eq("id", entryId),
      "foreign_entry_denial_check_failed",
    );
    assert(
      !foreignReadError && Array.isArray(foreignRows) && foreignRows.length === 0,
      "foreign_household_entry_visible",
    );

    const { data: foreignMutation, error: foreignMutationError } = await bounded(
      foreignFamily.client.rpc("acknowledge_entry", { p_entry_id: entryId }),
      "foreign_rpc_denial_check_failed",
    );
    assert(
      foreignMutationError?.code === "42501" && foreignMutation === null,
      "foreign_household_rpc_not_denied",
    );
    pass("Confirmed share, same-household visibility, and foreign Data API/RPC denial");

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
    pass("Referenced synthetic photo retained to preserve confirmed entry integrity");
  } finally {
    await cleanupChannels(channels);
    if (uploaded && !shareAttempted) {
      await cleanupUnreferencedUpload(helper, photoPath);
    }
  }
}

async function closeClients(accounts) {
  for (const account of Object.values(accounts)) {
    try {
      account.client.realtime.disconnect();
      await bounded(
        account.client.auth.signOut({ scope: "local" }),
        "local_session_cleanup_failed",
        5_000,
      );
    } catch {
      // Local session cleanup must not disclose or override the verification result.
    }
  }
}

export async function runCloudSupabaseVerification(environment = process.env) {
  const loaded = loadCloudSupabaseConfig(environment);
  if (loaded.status === "skip") {
    skip(loaded.missing);
    return Object.freeze({ status: "skipped" });
  }
  if (loaded.status === "invalid") fail(loaded.reason);

  const accounts = await verifyInvitedAccounts(loaded.config);
  try {
    await verifyInvitationOnly(loaded.config);
    await verifyPrivateShareAndRealtime(accounts);
  } finally {
    await closeClients(accounts);
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
    const code =
      error instanceof SafeVerificationError
        ? error.message
        : "unexpected_verification_failure";
    console.error(`${PREFIX} FAIL ${code}`);
    process.exitCode = 1;
  });
}
