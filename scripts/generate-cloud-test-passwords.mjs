import { randomBytes, randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLOUD_PASSWORD_KEYS = Object.freeze([
  "HOMERELAY_CLOUD_FAMILY_PASSWORD",
  "HOMERELAY_CLOUD_HELPER_PASSWORD",
  "HOMERELAY_CLOUD_FOREIGN_FAMILY_PASSWORD",
]);

function makePassword() {
  return `${randomBytes(32).toString("base64url")}Aa1!`;
}

export function upsertHiddenValues(source, values) {
  const allowedKeys = new Set(CLOUD_PASSWORD_KEYS);
  for (const key of values.keys()) {
    if (!allowedKeys.has(key)) {
      throw new Error("env_key_not_allowed");
    }
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = source.endsWith("\n");
  const lines = source.split(/\r?\n/);

  if (hadTrailingNewline) {
    lines.pop();
  }

  const remaining = new Set(values.keys());
  const output = [];

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = match?.[1];

    if (!key || !values.has(key)) {
      output.push(line);
      continue;
    }

    if (remaining.has(key)) {
      output.push(`${key}=${values.get(key)}`);
      remaining.delete(key);
    }
  }

  if (remaining.size > 0 && output.length > 0 && output.at(-1) !== "") {
    output.push("");
  }

  for (const key of CLOUD_PASSWORD_KEYS) {
    if (remaining.has(key)) {
      output.push(`${key}=${values.get(key)}`);
      remaining.delete(key);
    }
  }

  return `${output.join(newline)}${newline}`;
}

export async function atomicReplaceEnvFile(target, expectedSource, next) {
  const temporaryPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let temporaryHandle;

  try {
    temporaryHandle = await open(temporaryPath, "wx", 0o600);
    await temporaryHandle.writeFile(next, { encoding: "utf8" });
    await temporaryHandle.chmod(0o600);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;

    const currentStat = await lstat(target);
    if (!currentStat.isFile() || currentStat.isSymbolicLink()) {
      throw new Error("env_target_not_regular_file");
    }

    const currentSource = await readFile(target, "utf8");
    if (currentSource !== expectedSource) {
      throw new Error("env_target_changed_during_update");
    }

    await rename(temporaryPath, target);
  } finally {
    await temporaryHandle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export async function generateCloudTestPasswords({
  workspace = process.cwd(),
  envFile = ".env.local",
} = {}) {
  const target = path.resolve(workspace, envFile);
  const expected = path.join(path.resolve(workspace), ".env.local");

  if (target !== expected) {
    throw new Error("env_target_not_allowed");
  }

  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("env_target_not_regular_file");
  }

  const passwords = new Set();
  while (passwords.size < CLOUD_PASSWORD_KEYS.length) {
    passwords.add(makePassword());
  }

  const values = new Map(
    CLOUD_PASSWORD_KEYS.map((key, index) => [key, [...passwords][index]]),
  );
  const source = await readFile(target, "utf8");
  const next = upsertHiddenValues(source, values);

  for (const key of CLOUD_PASSWORD_KEYS) {
    const count = next
      .split(/\r?\n/)
      .filter((line) => line.startsWith(`${key}=`)).length;
    if (count !== 1) {
      throw new Error("env_update_validation_failed");
    }
  }

  await atomicReplaceEnvFile(target, source, next);
  return CLOUD_PASSWORD_KEYS.length;
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  try {
    const count = await generateCloudTestPasswords();
    console.log(
      `[generate-cloud-test-passwords] PASS: ${count}件を.env.localへ保存しました（値は非表示）。`,
    );
  } catch {
    console.error(
      "[generate-cloud-test-passwords] FAIL: .env.localの安全条件を確認してください（値は非表示）。",
    );
    process.exitCode = 1;
  }
}
