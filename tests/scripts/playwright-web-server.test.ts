import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

type ServerEnvironmentModule = Readonly<{
  configurePlaywrightWebServerEnvironment: (
    environment: Record<string, string | undefined>,
  ) => void;
}>;

let serverEnvironment: ServerEnvironmentModule;

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "scripts", "playwright-web-server-env.mjs"),
  ).href;
  serverEnvironment = (await import(
    /* @vite-ignore */ moduleUrl
  )) as ServerEnvironmentModule;
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

  it("normalizes the live opt-in at every Playwright entry point", async () => {
    const sources = await Promise.all(
      [
        "playwright.config.ts",
        "scripts/playwright-global-teardown.mjs",
        "tests/e2e/live-flow.spec.ts",
      ].map((file) => readFile(resolve(process.cwd(), file), "utf8")),
    );

    for (const source of sources) {
      expect(source).toContain(
        'HOMERELAY_E2E_LIVE?.trim().toLowerCase() === "true"',
      );
    }
  });

  it("never reuses a server that may have live credentials loaded", async () => {
    const source = await readFile(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(source).toMatch(/reuseExistingServer:\s*false/);
  });
});
