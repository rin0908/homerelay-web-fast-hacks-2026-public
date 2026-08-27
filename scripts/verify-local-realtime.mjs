import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL_ENV_NAME = "HOMERELAY_TEST_SUPABASE_URL";
const KEY_ENV_NAME = "HOMERELAY_TEST_SUPABASE_PUBLISHABLE_KEY";
const SECRET_KEY_ENV_NAME = "HOMERELAY_TEST_SUPABASE_SECRET_KEY";
const SUPABASE_URL = process.env[URL_ENV_NAME]?.trim();
const SUPABASE_PUBLISHABLE_KEY = process.env[KEY_ENV_NAME]?.trim();
const SUPABASE_SECRET_KEY = process.env[SECRET_KEY_ENV_NAME]?.trim();

const PHOTO_BUCKET = "handoff-photos";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const REQUEST_TIMEOUT_MS = 15_000;
const SUBSCRIBE_TIMEOUT_MS = 15_000;
const EVENT_TIMEOUT_MS = 30_000;
const NEGATIVE_OBSERVATION_MS = 1_500;
let runtimePassword = "";

const SYNTHETIC_ACCOUNTS = {
  familyA: {
    id: "10000000-0000-4000-8000-000000000001",
    email: "family-a@homerelay.test",
    role: "family",
  },
  familyB: {
    id: "20000000-0000-4000-8000-000000000001",
    email: "family-b@homerelay.test",
    role: "family",
  },
  helperA: {
    id: "10000000-0000-4000-8000-000000000002",
    email: "helper-a@homerelay.test",
    role: "helper",
  },
};

function pass(message) {
  console.log(`[verify-local-realtime] PASS ${message}`);
}

function skip(message) {
  console.log(`[verify-local-realtime] SKIP / 非接続: ${message}`);
}

function redact(value) {
  let result = String(value ?? "unknown error");
  for (const secret of [
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY,
    runtimePassword,
  ]) {
    if (secret) result = result.split(secret).join("[redacted]");
  }
  return result.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fail(message, error) {
  const code = error && typeof error === "object" && "code" in error
    ? ` (${redact(error.code)})`
    : "";
  const detail = error && typeof error === "object" && "message" in error
    ? `: ${redact(error.message)}`
    : "";
  throw new Error(`${message}${code}${detail}`);
}

async function bounded(operation, label, timeoutMs = REQUEST_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} が${timeoutMs}msでtimeoutしました`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function createTestClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function provisionRuntimePasswords() {
  runtimePassword = `${randomBytes(32).toString("base64url")}Aa1!`;
  const admin = createAdminClient();

  for (const [label, account] of Object.entries(SYNTHETIC_ACCOUNTS)) {
    const { data: existing, error: lookupError } = await bounded(
      admin.auth.admin.getUserById(account.id),
      `${label} synthetic user確認`,
    );
    if (lookupError) fail(`${label} のsynthetic user確認に失敗しました`, lookupError);
    assert(
      existing.user?.id === account.id && existing.user.email === account.email,
      `${label} の固定synthetic userが一致しません`,
    );

    const { data: updated, error: updateError } = await bounded(
      admin.auth.admin.updateUserById(account.id, { password: runtimePassword }),
      `${label} runtime password設定`,
    );
    if (updateError) fail(`${label} のruntime password設定に失敗しました`, updateError);
    assert(updated.user?.id === account.id, `${label} のpassword更新対象が一致しません`);
  }

  pass("Auth: 固定synthetic userへruntime-only passwordを設定");
  return runtimePassword;
}

async function signIn(label, account, password) {
  const client = createTestClient();
  const { data, error } = await bounded(
    client.auth.signInWithPassword({ email: account.email, password }),
    `${label} sign-in`,
  );

  if (error) fail(`${label} のsign-inに失敗しました`, error);
  assert(data.user && data.session, `${label} のsessionが返りませんでした`);
  await bounded(
    client.realtime.setAuth(data.session.access_token),
    `${label} Realtime token設定`,
  );

  const { data: membership, error: membershipError } = await bounded(
    client
      .from("members")
      .select("id, household_id, role")
      .eq("auth_user_id", data.user.id)
      .single(),
    `${label} membership取得`,
  );

  if (membershipError) fail(`${label} のmembership取得に失敗しました`, membershipError);
  assert(membership?.role === account.role, `${label} のseed roleが一致しません`);
  return { client, membership };
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
    waitFor(predicate, description) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`${description} を${EVENT_TIMEOUT_MS}ms以内に受信できませんでした`));
          }, EVENT_TIMEOUT_MS),
        };
        waiters.add(waiter);
      });
    },
  };
}

function subscribeChannel(channel, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} が${SUBSCRIBE_TIMEOUT_MS}ms以内にSUBSCRIBEDになりませんでした`));
    }, SUBSCRIBE_TIMEOUT_MS);

    channel.subscribe((status, error) => {
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
        reject(new Error(`${label} subscription ${status}: ${redact(error?.message ?? error ?? status)}`));
      }
    });
  });
}

async function callBooleanRpc(client, functionName, args, label) {
  const { data, error } = await bounded(client.rpc(functionName, args), label);
  if (error) fail(`${label}に失敗しました`, error);
  assert(data === true, `${label}がtrueを返しませんでした`);
}

async function verifyRealtime(familyA, familyB, helperA) {
  assert(
    familyA.membership.household_id === helperA.membership.household_id,
    "family Aとhelper Aが同じhouseholdではありません",
  );
  assert(
    familyB.membership.household_id !== helperA.membership.household_id,
    "family Bが別householdではありません",
  );

  const runId = randomUUID();
  const itemName = `合成Realtime検証品-${runId}`;
  const photoPath = [
    helperA.membership.household_id,
    helperA.membership.id,
    `${runId}.jpg`,
  ].join("/");
  const syntheticJpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  const photoSha256 = createHash("sha256").update(syntheticJpeg).digest("hex");
  const familyEntries = createEventProbe();
  const familyItems = createEventProbe();
  const foreignEntries = createEventProbe();
  const channels = [];
  let uploaded = false;
  let verificationError;

  const householdFilter = `household_id=eq.${helperA.membership.household_id}`;
  const familyChannel = familyA.client
    .channel(`verify-family-${runId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "entries", filter: householdFilter },
      (payload) => familyEntries.push(payload),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "needed_items", filter: householdFilter },
      (payload) => familyItems.push(payload),
    );
  const foreignChannel = familyB.client
    .channel(`verify-foreign-${runId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "entries", filter: householdFilter },
      (payload) => foreignEntries.push(payload),
    );
  channels.push(
    { channel: familyChannel, client: familyA.client, label: "family A" },
    { channel: foreignChannel, client: familyB.client, label: "family B" },
  );

  try {
    await Promise.all([
      subscribeChannel(familyChannel, "family A Realtime"),
      subscribeChannel(foreignChannel, "family B Realtime"),
    ]);
    pass("Realtime: family A / family B channels SUBSCRIBED");
    // A freshly started local Realtime service can report SUBSCRIBED just
    // before its logical replication worker finishes warming up.
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const { error: uploadError } = await bounded(
      helperA.client.storage.from(PHOTO_BUCKET).upload(photoPath, syntheticJpeg, {
        cacheControl: "0",
        contentType: "image/jpeg",
        upsert: false,
      }),
      "private JPEG upload",
    );
    if (uploadError) fail("helper Aのprivate JPEG uploadに失敗しました", uploadError);
    uploaded = true;

    const { data: entryId, error: shareError } = await bounded(
      helperA.client.rpc("share_handoff", {
        p_completed_summary: "合成Realtime検証を開始しました",
        p_condition_summary: `合成Realtime申し送り-${runId}`,
        p_idempotency_key: runId,
        p_needed_items: [itemName],
        p_next_request: "次の方は合成Realtime状態をご確認ください",
        p_photo_alt: "合成Realtime検証用のJPEG写真",
        p_photo_path: photoPath,
        p_photo_sha256: photoSha256,
      }),
      "share_handoff",
    );
    if (shareError) fail("helper Aのshare_handoffに失敗しました", shareError);
    assert(typeof entryId === "string" && entryId.length > 0, "share_handoffがentry idを返しませんでした");

    const entryInsert = await familyEntries.waitFor(
      (payload) => payload.eventType === "INSERT" && payload.new?.id === entryId,
      "family A entries INSERT",
    );
    assert(
      entryInsert.new.household_id === helperA.membership.household_id,
      "Realtime entryのhouseholdが一致しません",
    );

    const itemInsert = await familyItems.waitFor(
      (payload) => payload.eventType === "INSERT" && payload.new?.entry_id === entryId,
      "family A needed_items INSERT",
    );
    const itemId = itemInsert.new?.id;
    assert(typeof itemId === "string" && itemId.length > 0, "Realtime itemがidを含みません");
    pass("Realtime: helper A shareをfamily Aがentries/needed_itemsで受信");

    const { data: foreignRows, error: foreignReadError } = await bounded(
      familyB.client.from("entries").select("id").eq("id", entryId),
      "family B entry visibility確認",
    );
    if (foreignReadError) fail("family Bのentry visibility確認に失敗しました", foreignReadError);
    assert(Array.isArray(foreignRows) && foreignRows.length === 0, "family Bからentryが見えています");

    await callBooleanRpc(
      familyA.client,
      "acknowledge_entry",
      { p_entry_id: entryId },
      "family A acknowledge_entry",
    );
    await callBooleanRpc(
      familyA.client,
      "claim_entry",
      { p_entry_id: entryId },
      "family A claim_entry",
    );
    await familyEntries.waitFor(
      (payload) => payload.eventType === "UPDATE"
        && payload.new?.id === entryId
        && payload.new?.status === "claimed",
      "family A entries claimed UPDATE",
    );
    await callBooleanRpc(
      familyA.client,
      "complete_entry",
      { p_entry_id: entryId },
      "family A complete_entry",
    );
    await familyEntries.waitFor(
      (payload) => payload.eventType === "UPDATE"
        && payload.new?.id === entryId
        && payload.new?.status === "done",
      "family A entries done UPDATE",
    );
    pass("Entry state: 確認 → claim → done とRealtime UPDATE");

    await callBooleanRpc(
      familyA.client,
      "claim_needed_item",
      { p_item_id: itemId },
      "family A claim_needed_item",
    );
    await familyItems.waitFor(
      (payload) => payload.eventType === "UPDATE"
        && payload.new?.id === itemId
        && payload.new?.status === "purchase_intent",
      "family A needed_items purchase_intent UPDATE",
    );
    await callBooleanRpc(
      familyA.client,
      "complete_needed_item",
      { p_item_id: itemId },
      "family A complete_needed_item",
    );
    await familyItems.waitFor(
      (payload) => payload.eventType === "UPDATE"
        && payload.new?.id === itemId
        && payload.new?.status === "purchased",
      "family A needed_items purchased UPDATE",
    );
    pass("Needed item: purchase_intent → purchased とRealtime UPDATE");

    const { data: finalEntry, error: finalEntryError } = await bounded(
      familyA.client
        .from("entries")
        .select("status, claimed_by_member_id")
        .eq("id", entryId)
        .single(),
      "final entry確認",
    );
    if (finalEntryError) fail("final entry確認に失敗しました", finalEntryError);
    assert(finalEntry.status === "done", "final entryがdoneではありません");
    assert(
      finalEntry.claimed_by_member_id === familyA.membership.id,
      "final entryの担当者がfamily Aではありません",
    );

    const { data: finalItem, error: finalItemError } = await bounded(
      familyA.client
        .from("needed_items")
        .select("status, claimed_by_member_id, purchased_at")
        .eq("id", itemId)
        .single(),
      "final needed item確認",
    );
    if (finalItemError) fail("final needed item確認に失敗しました", finalItemError);
    assert(finalItem.status === "purchased", "final needed itemがpurchasedではありません");
    assert(
      finalItem.claimed_by_member_id === familyA.membership.id,
      "final needed itemの担当者がfamily Aではありません",
    );
    assert(finalItem.purchased_at, "final needed itemにpurchased_atがありません");

    await new Promise((resolve) => setTimeout(resolve, NEGATIVE_OBSERVATION_MS));
    assert(
      !foreignEntries.events.some((payload) => payload.new?.id === entryId),
      "別householdのfamily BへRealtime entryが配信されました",
    );
    pass("RLS: family BはData API/Realtimeのどちらでもentry不可視");
  } catch (error) {
    verificationError = error;
  } finally {
    if (uploaded) {
      pass("referential integrity: 合成検証entryとprivate写真を整合して保持");
    }

    await Promise.allSettled(
      channels.map(({ channel, client, label }) =>
        bounded(client.removeChannel(channel), `${label} channel cleanup`, 5_000)),
    );
  }

  if (verificationError) throw verificationError;
}

async function main() {
  const missing = [
    [URL_ENV_NAME, SUPABASE_URL],
    [KEY_ENV_NAME, SUPABASE_PUBLISHABLE_KEY],
    [SECRET_KEY_ENV_NAME, SUPABASE_SECRET_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    skip(`${missing.join(" / ")} が未設定です。Auth/Storage/Realtimeへ接続していません。`);
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(SUPABASE_URL);
  } catch {
    skip(`${URL_ENV_NAME} が有効なURLではありません。接続していません。`);
    return;
  }

  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    !LOOPBACK_HOSTS.has(parsedUrl.hostname)
  ) {
    skip(`${URL_ENV_NAME} はloopbackのローカルSupabaseを指す必要があります。接続していません。`);
    return;
  }

  const password = await provisionRuntimePasswords();
  const helperA = await signIn("helper A", SYNTHETIC_ACCOUNTS.helperA, password);
  const familyA = await signIn("family A", SYNTHETIC_ACCOUNTS.familyA, password);
  const familyB = await signIn("family B", SYNTHETIC_ACCOUNTS.familyB, password);
  pass("Auth: helper A / family A / family B のsynthetic seed sign-in");

  try {
    await verifyRealtime(familyA, familyB, helperA);
  } finally {
    for (const { client } of [helperA, familyA, familyB]) {
      client.realtime.disconnect();
    }
  }
}

main().catch((error) => {
  console.error(`[verify-local-realtime] FAIL ${redact(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
});
