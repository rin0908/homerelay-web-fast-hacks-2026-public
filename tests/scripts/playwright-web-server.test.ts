import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("synthetic Playwright server isolation", () => {
  it("forces offline demo flags unless live E2E is explicitly enabled", async () => {
    const source = await readFile(
      resolve(process.cwd(), "scripts", "playwright-web-server.mjs"),
      "utf8",
    );

    expect(source).toContain(
      'const liveE2e = process.env.HOMERELAY_E2E_LIVE === "true";',
    );
    expect(source).toContain(
      'process.env.HOMERELAY_E2E_ISOLATE_VENDORS = "true";',
    );
    expect(source).toMatch(/if \(!liveE2e\) \{[\s\S]*HOMERELAY_DEMO_MODE = "true";/);
    expect(source).toMatch(/if \(!liveE2e\) \{[\s\S]*HOMERELAY_DATA_MODE = "demo";/);
    expect(source).toContain('process.env.HOMERELAY_OPENAI_VERIFY = "false";');
  });

  it("never reuses a server that may have live credentials loaded", async () => {
    const source = await readFile(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(source).toMatch(/reuseExistingServer:\s*false/);
  });
});
