import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL_ENV_NAME = "HOMERELAY_TEST_SUPABASE_URL";
const KEY_ENV_NAME = "HOMERELAY_TEST_SUPABASE_PUBLISHABLE_KEY";
const SUPABASE_URL = process.env[URL_ENV_NAME]?.trim();
const SUPABASE_PUBLISHABLE_KEY = process.env[KEY_ENV_NAME]?.trim();

const LOCAL_PASSWORD = "HomeRelayDemo2026!";
const PHOTO_BUCKET = "handoff-photos";
const VERIFY_IDEMPOTENCY_KEY = "f0000000-0000-4000-8000-000000000001";
const VERIFY_ITEM_NAME = "合成ローカル検証用ティッシュ";
const VERIFY_SUMMARY = "合成ローカル検証の申し送りです";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const SYNTHETIC_ACCOUNTS = {
  familyA: {
    email: "family-a@homerelay.test",
    role: "family",
  },
  familyB: {
    email: "family-b@homerelay.test",
    role: "family",
  },
  helperA: {
    email: "helper-a@homerelay.test",
    role: "helper",
  },
};

function pass(message) {
  console.log(`[verify-local-supabase] PASS ${message}`);
}

function skip(message) {
  console.log(`[verify-local-supabase] SKIP / 非接続: ${message}`);
}

function redact(value) {
  let result = String(value ?? "unknown error");
  for (const secret of [SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY]) {
    if (secret) result = result.split(secret).join("[redacted]");
  }
  return result.replace(/[\r\n]+/g, " ").slice(0, 500);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function signIn(label, account) {
  const client = createTestClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: account.email,
    password: LOCAL_PASSWORD,
  });

  if (error) fail(`${label} のsign-inに失敗しました`, error);
  assert(data.user && data.session, `${label} のsessionが返りませんでした`);

  const { data: membership, error: membershipError } = await client
    .from("members")
    .select("id, household_id, role")
    .eq("auth_user_id", data.user.id)
    .single();

  if (membershipError) fail(`${label} のmembership取得に失敗しました`, membershipError);
  assert(membership?.role === account.role, `${label} のseed roleが一致しません`);

  return { client, membership };
}

async function verifyInvitationOnly() {
  const client = createTestClient();
  const { data, error } = await client.auth.signUp({
    email: `uninvited-${randomUUID()}@homerelay.test`,
    password: LOCAL_PASSWORD,
  });

  assert(error, "未招待ユーザーのsign-upが拒否されませんでした");
  assert(!data.user && !data.session, "未招待ユーザーにAuthデータが返りました");
  pass("Auth: 未招待ユーザーの新規登録拒否");
}

async function verifyDataApi(familyA, familyB, helperA) {
  assert(
    familyA.membership.household_id === helperA.membership.household_id,
    "family Aとhelper Aが同じhouseholdではありません",
  );
  assert(
    familyB.membership.household_id !== helperA.membership.household_id,
    "family Bが別householdではありません",
  );

  const photoPath = [
    helperA.membership.household_id,
    helperA.membership.id,
    `${VERIFY_IDEMPOTENCY_KEY}.jpg`,
  ].join("/");
  const syntheticJpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  const photoSha256 = createHash("sha256").update(syntheticJpeg).digest("hex");
  const referencedBucket = helperA.client.storage.from(PHOTO_BUCKET);
  const { error: referencedUploadError } = await referencedBucket.upload(
    photoPath,
    syntheticJpeg,
    { cacheControl: "0", contentType: "image/jpeg", upsert: false },
  );
  if (referencedUploadError) {
    const { data: existingPhoto, error: existingPhotoError } =
      await referencedBucket.download(photoPath);
    if (existingPhotoError || !existingPhoto) {
      fail("検証entryが参照するprivate写真を準備できませんでした", referencedUploadError);
    }
  }

  const { data: entryId, error: shareError } = await helperA.client.rpc("share_handoff", {
    p_completed_summary: "合成ローカル検証を実行しました",
    p_condition_summary: VERIFY_SUMMARY,
    p_idempotency_key: VERIFY_IDEMPOTENCY_KEY,
    p_needed_items: [VERIFY_ITEM_NAME],
    p_next_request: "次の方は合成検証結果をご確認ください",
    p_photo_alt: "合成ローカル検証用の写真",
    p_photo_path: photoPath,
    p_photo_sha256: photoSha256,
  });

  if (shareError) fail("helper Aのshare_handoffに失敗しました", shareError);
  assert(typeof entryId === "string" && entryId.length > 0, "share_handoffがentry idを返しませんでした");

  const { data: familyEntry, error: familyEntryError } = await familyA.client
    .from("entries")
    .select("id, household_id, status, condition_summary")
    .eq("id", entryId)
    .maybeSingle();

  if (familyEntryError) fail("family Aのentry取得に失敗しました", familyEntryError);
  assert(familyEntry?.id === entryId, "同じhouseholdのfamily Aからentryが見えません");
  assert(familyEntry.household_id === familyA.membership.household_id, "entryのhouseholdが一致しません");
  assert(familyEntry.status === "confirmed", "entryがconfirmedではありません");
  assert(familyEntry.condition_summary === VERIFY_SUMMARY, "entryの合成summaryが一致しません");

  const { data: foreignEntries, error: foreignReadError } = await familyB.client
    .from("entries")
    .select("id")
    .eq("id", entryId);

  if (foreignReadError) fail("family BのRLS select確認に失敗しました", foreignReadError);
  assert(Array.isArray(foreignEntries) && foreignEntries.length === 0, "別householdからentryが見えています");

  const { data: neededItem, error: neededItemError } = await familyA.client
    .from("needed_items")
    .select("id")
    .eq("entry_id", entryId)
    .eq("name", VERIFY_ITEM_NAME)
    .single();

  if (neededItemError) fail("検証用needed itemの取得に失敗しました", neededItemError);

  const { error: foreignEntryMutationError } = await familyB.client.rpc("acknowledge_entry", {
    p_entry_id: entryId,
  });
  assert(foreignEntryMutationError, "別householdのguarded entry RPCが拒否されませんでした");
  assert(
    foreignEntryMutationError.code === "42501",
    `guarded entry RPCの拒否codeが不正です (${redact(foreignEntryMutationError.code)})`,
  );

  const { error: foreignItemMutationError } = await familyB.client.rpc("claim_needed_item", {
    p_item_id: neededItem.id,
  });
  assert(foreignItemMutationError, "別householdのguarded item RPCが拒否されませんでした");
  assert(
    foreignItemMutationError.code === "42501",
    `guarded item RPCの拒否codeが不正です (${redact(foreignItemMutationError.code)})`,
  );

  pass("Auth: family A / family B / helper A のsynthetic seed sign-in");
  pass("Data API: 同一household可視・別household不可視");
  pass("guarded RPC: 別householdのentry/item mutation拒否");
  pass("referential integrity: 検証entryとprivate写真を整合して保持");
}

async function verifyStorage(helperA, familyB) {
  const temporaryObjectId = randomUUID();
  const temporaryObjectPath = [
    helperA.membership.household_id,
    helperA.membership.id,
    `${temporaryObjectId}.jpg`,
  ].join("/");
  const syntheticJpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  let uploaded = false;
  let verificationError;

  try {
    const { error: uploadError } = await helperA.client.storage
      .from(PHOTO_BUCKET)
      .upload(temporaryObjectPath, syntheticJpeg, {
        cacheControl: "0",
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) fail("helper Aのprivate Storage uploadに失敗しました", uploadError);
    uploaded = true;

    const { data: ownPhoto, error: ownReadError } = await helperA.client.storage
      .from(PHOTO_BUCKET)
      .download(temporaryObjectPath);

    if (ownReadError) fail("helper Aのprivate Storage readに失敗しました", ownReadError);
    assert(ownPhoto && ownPhoto.size > 0, "helper Aのprivate objectが空です");

    const { data: foreignPhoto, error: foreignReadError } = await familyB.client.storage
      .from(PHOTO_BUCKET)
      .download(temporaryObjectPath);

    assert(foreignReadError, "別householdのprivate Storage readが拒否されませんでした");
    assert(foreignPhoto === null, "別householdへprivate object dataが返りました");

    pass("Storage: own private upload/read・別household read拒否");
  } catch (error) {
    verificationError = error;
  } finally {
    if (uploaded) {
      const { data: removed, error: removeError } = await helperA.client.storage
        .from(PHOTO_BUCKET)
        .remove([temporaryObjectPath]);

      if (removeError) {
        throw new Error(`一時Storage objectの後始末に失敗しました: ${redact(removeError.message)}`, {
          cause: verificationError,
        });
      }
      assert(
        removed?.some((object) => object.name === temporaryObjectPath),
        "一時Storage objectの削除結果を確認できませんでした",
      );
      pass("cleanup: この実行で作成した一時Storage objectのみ削除");
    }
  }

  if (verificationError) throw verificationError;
}

async function main() {
  const missing = [
    [URL_ENV_NAME, SUPABASE_URL],
    [KEY_ENV_NAME, SUPABASE_PUBLISHABLE_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    skip(`${missing.join(" / ")} が未設定です。Data API/Auth/Storageへ接続していません。`);
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(SUPABASE_URL);
  } catch {
    skip(`${URL_ENV_NAME} が有効なURLではありません。接続していません。`);
    return;
  }

  if (!LOOPBACK_HOSTS.has(parsedUrl.hostname)) {
    skip(`${URL_ENV_NAME} はloopbackのローカルSupabaseを指す必要があります。接続していません。`);
    return;
  }

  const familyA = await signIn("family A", SYNTHETIC_ACCOUNTS.familyA);
  const familyB = await signIn("family B", SYNTHETIC_ACCOUNTS.familyB);
  const helperA = await signIn("helper A", SYNTHETIC_ACCOUNTS.helperA);

  await verifyInvitationOnly();
  await verifyDataApi(familyA, familyB, helperA);
  await verifyStorage(helperA, familyB);
}

main().catch((error) => {
  console.error(`[verify-local-supabase] FAIL ${redact(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
});
