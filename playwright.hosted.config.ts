import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const PREVIEW_HOST_PATTERN =
  /^homerelay-web-fast-hacks-2026(?:-[a-z0-9-]+)?\.vercel\.app$/i;

function fail(code: string): never {
  throw new Error(`Hosted E2E configuration refused: ${code}`);
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

function allowedFixturePath(value: string): string {
  const workspaceRoot = realpathSync(process.cwd());
  // Live synthetic audio is intentionally transient under this Git-ignored root.
  const ignoredFixtureRoot = path.join(workspaceRoot, ".vercel");
  const requested = path.resolve(workspaceRoot, value);
  const requestedStatus = lstatSync(requested);
  if (!requestedStatus.isFile() || requestedStatus.isSymbolicLink()) {
    return fail("synthetic_audio_not_a_regular_file");
  }

  const resolved = realpathSync(requested);
  const relative = path.relative(ignoredFixtureRoot, resolved);
  const status = statSync(resolved);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.extname(resolved).toLowerCase() !== ".wav" ||
    status.size <= 44 ||
    status.size > 2_000_000
  ) {
    return fail("synthetic_audio_path_refused");
  }
  return resolved;
}

if (process.env.HOMERELAY_HOSTED_E2E?.trim().toLowerCase() !== "true") {
  fail("explicit_opt_in_required");
}

const previewOrigin = parsePreviewOrigin(
  requiredEnvironment("HOMERELAY_PREVIEW_URL"),
).origin;
const syntheticAudioFile = allowedFixturePath(
  requiredEnvironment("HOMERELAY_HOSTED_SYNTHETIC_AUDIO_FILE"),
);
const fakeCameraFile = path.resolve(
  process.cwd(),
  "tests/fixtures/fake-camera.y4m",
);

export default defineConfig({
  expect: { timeout: 20_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: ".vercel/playwright-hosted-results",
  projects: [{ name: "hosted-cross-device" }],
  reporter: "list",
  retries: 0,
  testDir: "./tests/e2e",
  testMatch: "hosted-flow.spec.ts",
  timeout: 240_000,
  use: {
    acceptDownloads: false,
    baseURL: previewOrigin,
    browserName: "chromium",
    channel: "chrome",
    locale: "ja-JP",
    permissions: ["camera", "microphone"],
    screenshot: "off",
    trace: "off",
    video: "off",
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${syntheticAudioFile}`,
        `--use-file-for-fake-video-capture=${fakeCameraFile}`,
      ],
    },
  },
  workers: 1,
});
