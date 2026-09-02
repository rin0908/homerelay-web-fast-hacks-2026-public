import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

type ServerEnvironmentModule = Readonly<{
  configurePlaywrightWebServerEnvironment: (
    environment: Record<string, string | undefined>,
  ) => void;
}>;

type LiveE2eModule = Readonly<{
  PLAYWRIGHT_LIVE_E2E_PROJECT: "desktop-1280";
  isPlaywrightLiveE2EEnabled: (
    environment: Record<string, string | undefined>,
  ) => boolean;
  shouldRunPlaywrightLiveE2EProject: (
    liveEnabled: boolean,
    projectName: string,
  ) => boolean;
}>;

let serverEnvironment: ServerEnvironmentModule;
let liveE2e: LiveE2eModule;

beforeAll(async () => {
  const [serverEnvironmentModule, liveE2eModule] = await Promise.all(
    ["playwright-web-server-env.mjs", "playwright-live-e2e.mjs"].map(
      async (file) =>
        import(
          /* @vite-ignore */ pathToFileURL(
            resolve(process.cwd(), "scripts", file),
          ).href
        ),
    ),
  );
  serverEnvironment = serverEnvironmentModule as ServerEnvironmentModule;
  liveE2e = liveE2eModule as LiveE2eModule;
});

describe("synthetic Playwright server isolation", () => {
  it("forces offline demo flags unless live E2E is explicitly enabled", async () => {
    const environment = {
      HOMERELAY_DATA_MODE: "supabase",
      HOMERELAY_DEMO_MODE: "false",
      HOMERELAY_E2E_ISOLATE_VENDORS: "false",
      HOMERELAY_E2E_LIVE: " FALSE ",
      HOMERELAY_OPENAI_VERIFY: "true",
    };

    serverEnvironment.configurePlaywrightWebServerEnvironment(environment);

    expect(environment).toMatchObject({
      HOMERELAY_DATA_MODE: "demo",
      HOMERELAY_DEMO_MODE: "true",
      HOMERELAY_E2E_ISOLATE_VENDORS: "true",
      HOMERELAY_OPENAI_VERIFY: "false",
    });
  });

  it("retains vendor isolation without replacing live data flags", () => {
    const environment = {
      HOMERELAY_DATA_MODE: "supabase",
      HOMERELAY_DEMO_MODE: "false",
      HOMERELAY_E2E_ISOLATE_VENDORS: "true",
      HOMERELAY_E2E_LIVE: " TRUE ",
      HOMERELAY_OPENAI_VERIFY: "true",
    };

    serverEnvironment.configurePlaywrightWebServerEnvironment(environment);

    expect(environment).toMatchObject({
      HOMERELAY_DATA_MODE: "supabase",
      HOMERELAY_DEMO_MODE: "false",
      HOMERELAY_E2E_ISOLATE_VENDORS: "true",
      HOMERELAY_OPENAI_VERIFY: "false",
    });
  });

  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    [" TRUE ", true],
    ["TrUe", true],
    ["1", false],
  ])("parses the live opt-in %j as %s", (value, expected) => {
    expect(
      liveE2e.isPlaywrightLiveE2EEnabled({ HOMERELAY_E2E_LIVE: value }),
    ).toBe(expected);
  });

  it.each([
    [true, "desktop-1280", true],
    [true, "phone-390", false],
    [false, "desktop-1280", false],
    [true, "desktop-1280 ", false],
  ])(
    "runs live fixture setup only when enabled for project %j",
    (enabled, projectName, expected) => {
      expect(
        liveE2e.shouldRunPlaywrightLiveE2EProject(enabled, projectName),
      ).toBe(expected);
    },
  );

  it("pins live fixture setup to the one desktop project", () => {
    expect(liveE2e.PLAYWRIGHT_LIVE_E2E_PROJECT).toBe("desktop-1280");
  });

  it("never reuses a server that may have live credentials loaded", async () => {
    const source = await readFile(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(source).toMatch(/reuseExistingServer:\s*false/);
  });
});
