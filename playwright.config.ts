import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const liveE2e = process.env.HOMERELAY_E2E_LIVE === "true";
const e2ePort = liveE2e ? 3101 : 3100;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const fakeCameraFile = path.resolve(
  process.cwd(),
  "tests/fixtures/fake-camera.y4m",
);

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./scripts/playwright-global-teardown.mjs",
  expect: {
    timeout: liveE2e ? 15_000 : 5_000,
  },
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: e2eBaseUrl,
    browserName: "chromium",
    ...(process.env.CI ? {} : { channel: "chrome" }),
    locale: "ja-JP",
    permissions: ["camera", "microphone"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-video-capture=${fakeCameraFile}`,
      ],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node scripts/playwright-web-server.mjs ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: !liveE2e,
    timeout: 120_000,
  },
  projects: [
    {
      name: "phone-390",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop-1280",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});
