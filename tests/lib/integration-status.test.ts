import { afterEach, describe, expect, it, vi } from "vitest";
import { getIntegrationStatus } from "@/lib/integration-status";

vi.mock("server-only", () => ({}));

const ENV_NAMES = [
  "HOMERELAY_DEMO_MODE",
  "HOMERELAY_DATA_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "OPENAI_API_KEY",
  "QDRANT_URL",
  "QDRANT_API_KEY",
] as const;

const ORIGINAL_ENV = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = ORIGINAL_ENV[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("getIntegrationStatus", () => {
  it("defaults to the explicit synthetic demo without connection claims", () => {
    for (const name of ENV_NAMES) delete process.env[name];

    expect(getIntegrationStatus()).toMatchObject({
      appMode: "demo",
      dataMode: "demo",
      requestedDataMode: "demo",
      openai: { active: false, configured: false, connectionVerified: false },
      supabase: { active: false, configured: false, connectionVerified: false },
      qdrant: { active: false, configured: false, connectionVerified: false },
    });
  });

  it("does not silently fall back when Supabase mode lacks public config", () => {
    for (const name of ENV_NAMES) delete process.env[name];
    process.env.HOMERELAY_DATA_MODE = "supabase";

    expect(getIntegrationStatus()).toMatchObject({
      appMode: "demo",
      configurationIssue: "supabase_public_config_missing",
      dataMode: "misconfigured",
      requestedDataMode: "supabase",
    });
  });

  it("activates Supabase independently from optional Qdrant and admin keys", () => {
    for (const name of ENV_NAMES) delete process.env[name];
    process.env.HOMERELAY_DATA_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable";

    expect(getIntegrationStatus()).toMatchObject({
      appMode: "live",
      dataMode: "supabase",
      supabase: { active: true, configured: true, connectionVerified: false },
      supabaseAdmin: { active: false, configured: false },
      qdrant: { active: false, configured: false },
    });
  });

  it("lets the emergency flag force demo even when credentials exist", () => {
    process.env.HOMERELAY_DEMO_MODE = "true";
    process.env.HOMERELAY_DATA_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable";
    process.env.OPENAI_API_KEY = "synthetic-openai";

    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "demo",
      requestedDataMode: "demo",
      openai: { active: false, configured: true },
      supabase: { active: false, configured: true },
    });
  });
});
