import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The production password generator intentionally remains a directly executable ESM script.
// @ts-expect-error The .mjs password generator does not publish TypeScript declarations.
import * as passwordGenerator from "../../scripts/generate-cloud-test-passwords.mjs";

const {
  atomicReplaceEnvFile,
  CLOUD_PASSWORD_KEYS,
  generateCloudTestPasswords,
} = passwordGenerator;

async function withTemporaryWorkspace(
  run: (workspace: string) => Promise<void>,
) {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), "homerelay-password-generator-"),
  );
  try {
    await run(workspace);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

describe("cloud test password storage", () => {
  it("atomically replaces .env.local while preserving unrelated values", async () => {
    await withTemporaryWorkspace(async (workspace) => {
      const target = path.join(workspace, ".env.local");
      const source = [
        "UNCHANGED_SETTING=preserved",
        `${CLOUD_PASSWORD_KEYS[0]}=old-family`,
        `${CLOUD_PASSWORD_KEYS[0]}=duplicate-family`,
        `${CLOUD_PASSWORD_KEYS[1]}=old-helper`,
        "",
      ].join("\r\n");
      await writeFile(target, source, { encoding: "utf8", mode: 0o600 });

      await expect(
        generateCloudTestPasswords({ workspace }),
      ).resolves.toBe(CLOUD_PASSWORD_KEYS.length);

      const next = await readFile(target, "utf8");
      const lines = next.split(/\r?\n/);
      expect(next).toContain("UNCHANGED_SETTING=preserved\r\n");

      const generatedValues = new Set<string>();
      for (const key of CLOUD_PASSWORD_KEYS) {
        const matches = lines.filter((line) => line.startsWith(`${key}=`));
        expect(matches).toHaveLength(1);
        const value = matches[0].slice(key.length + 1);
        expect(value.length).toBeGreaterThanOrEqual(32);
        generatedValues.add(value);
      }
      expect(generatedValues.size).toBe(CLOUD_PASSWORD_KEYS.length);
      expect(await readdir(workspace)).toEqual([".env.local"]);

      if (process.platform !== "win32") {
        expect((await stat(target)).mode & 0o777).toBe(0o600);
      }
    });
  });

  it("does not overwrite a concurrently changed target and removes its temp file", async () => {
    await withTemporaryWorkspace(async (workspace) => {
      const target = path.join(workspace, ".env.local");
      await writeFile(target, "CURRENT=value\n", {
        encoding: "utf8",
        mode: 0o600,
      });

      await expect(
        atomicReplaceEnvFile(target, "STALE=value\n", "NEXT=value\n"),
      ).rejects.toThrow("env_target_changed_during_update");

      expect(await readFile(target, "utf8")).toBe("CURRENT=value\n");
      expect(await readdir(workspace)).toEqual([".env.local"]);
    });
  });
});
