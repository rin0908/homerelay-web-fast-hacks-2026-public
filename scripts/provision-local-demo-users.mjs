import { createClient } from "@supabase/supabase-js";

const URL_ENV_NAME = "HOMERELAY_LOCAL_SUPABASE_URL";
const SECRET_ENV_NAME = "HOMERELAY_LOCAL_SUPABASE_SECRET_KEY";
const PASSWORD_ENV_NAME = "HOMERELAY_LOCAL_DEMO_PASSWORD";
const urlValue = process.env[URL_ENV_NAME]?.trim() ?? "";
const secretKey = process.env[SECRET_ENV_NAME]?.trim() ?? "";
const password = process.env[PASSWORD_ENV_NAME] ?? "";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const USERS = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    email: "family-a@homerelay.test",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    email: "helper-a@homerelay.test",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    email: "relative-a@homerelay.test",
  },
  {
    id: "20000000-0000-4000-8000-000000000001",
    email: "family-b@homerelay.test",
  },
];

function skip(message) {
  console.log(`[provision-local-demo-users] SKIP: ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function safeConfiguration() {
  const missing = [
    [URL_ENV_NAME, urlValue],
    [SECRET_ENV_NAME, secretKey],
    [PASSWORD_ENV_NAME, password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    skip(`${missing.join(" / ")} が未設定です。`);
    return null;
  }

  let url;
  try {
    url = new URL(urlValue);
  } catch {
    fail(`${URL_ENV_NAME} が有効なURLではありません。`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !LOOPBACK_HOSTS.has(url.hostname)
  ) {
    fail("このscriptはloopbackのHomeRelayローカルSupabaseだけを許可します。");
  }
  if (
    password.length < 12 ||
    password.length > 128 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    /[\r\n\u0000]/.test(password)
  ) {
    fail(`${PASSWORD_ENV_NAME} は12〜128文字の英大文字・小文字・数字を含めてください。`);
  }
  if (secretKey.length < 20 || /\s/.test(secretKey)) {
    fail(`${SECRET_ENV_NAME} の形式を確認してください。`);
  }

  return { url: urlValue, secretKey };
}

async function main() {
  const config = safeConfiguration();
  if (!config) return;

  const admin = createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  for (const user of USERS) {
    const { data: existing, error: readError } =
      await admin.auth.admin.getUserById(user.id);
    if (
      readError ||
      existing.user?.id !== user.id ||
      existing.user.email !== user.email
    ) {
      fail("固定の合成ユーザーがローカルseedと一致しません。");
    }
    const { data: updated, error: updateError } =
      await admin.auth.admin.updateUserById(user.id, { password });
    if (updateError || updated.user?.id !== user.id) {
      fail("合成ユーザーのruntime passwordを設定できませんでした。");
    }
  }

  console.log(
    `[provision-local-demo-users] PASS ${USERS.length}件の固定合成ユーザーへ、環境変数からruntime passwordを設定しました。値は表示・保存していません。`,
  );
  console.log(
    `[provision-local-demo-users] Login emails: ${USERS.map(({ email }) => email).join(", ")}`,
  );
}

main().catch(() => {
  console.error(
    "[provision-local-demo-users] FAIL: loopback設定、secret key、合成seed userを確認してください。値は非表示です。",
  );
  process.exitCode = 1;
});
