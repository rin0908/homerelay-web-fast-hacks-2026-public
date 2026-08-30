import { afterEach, describe, expect, it, vi } from "vitest";
import { getIntegrationStatus } from "@/lib/integration-status";

vi.mock("server-only", () => ({}));

const ENV_NAMES = [
  "HOMERELAY_DEMO_MODE",
  "HOMERELAY_DATA_MODE",
  "HOMERELAY_E2E_ISOLATE_VENDORS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "OPENAI_API_KEY",
  "OPENAI_PROJECT_ID",
  "QDRANT_URL",
  "QDRANT_API_KEY",
  "QDRANT_COLLECTION",
  "QDRANT_EMBEDDING_MODEL",
  "QDRANT_TIMEOUT_MS",
  "QDRANT_VECTOR_SIZE",
  "NEO4J_URI",
  "NEO4J_USERNAME",
  "NEO4J_PASSWORD",
  "DD_API_KEY",
  "DD_SITE",
  "DATADOG_API_KEY",
  "DATADOG_TIMEOUT_MS",
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
      neo4j: { active: false, configured: false, connectionVerified: false },
      datadog: { active: false, configured: false, connectionVerified: false },
    });
  });

  it("keeps optional graph and metrics adapters inactive until live mode is explicit", () => {
    for (const name of ENV_NAMES) delete process.env[name];
    process.env.NEO4J_URI = "neo4j+s://synthetic.databases.neo4j.io";
    process.env.NEO4J_USERNAME = "neo4j";
    process.env.NEO4J_PASSWORD = "synthetic-password";
    process.env.DD_API_KEY = "a".repeat(32);
    process.env.DD_SITE = "ap1.datadoghq.com";

    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "demo",
      neo4j: { active: false, configured: true },
      datadog: { active: false, configured: true },
    });

    process.env.HOMERELAY_DATA_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable";

    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "supabase",
      neo4j: { active: true, configured: true },
      datadog: { active: true, configured: true },
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

  it("activates Supabase independently from optional Qdrant", () => {
    for (const name of ENV_NAMES) delete process.env[name];
    process.env.HOMERELAY_DATA_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable";

    expect(getIntegrationStatus()).toMatchObject({
      appMode: "live",
      dataMode: "supabase",
      supabase: { active: true, configured: true, connectionVerified: false },
      qdrant: { active: false, configured: false },
    });
  });

  it("never activates Qdrant outside authenticated Supabase mode", () => {
    for (const name of ENV_NAMES) delete process.env[name];
    process.env.QDRANT_URL = "https://synthetic.qdrant.test";
    process.env.QDRANT_API_KEY = "synthetic-qdrant-key";

    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "demo",
      qdrant: { active: false, configured: true, connectionVerified: false },
    });

    process.env.HOMERELAY_DATA_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable";

    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "supabase",
      qdrant: { active: true, configured: true, connectionVerified: false },
    });
  });

  it("lets the emergency flag force demo even when credentials exist", () => {
    process.env.HOMERELAY_DEMO_MODE = "true";
    process.env.HOMERELAY_DATA_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable";
    process.env.OPENAI_API_KEY = "synthetic-openai";
    process.env.OPENAI_PROJECT_ID = "proj_synthetic_homerelay";

    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "demo",
      requestedDataMode: "demo",
      openai: { active: false, configured: true },
      supabase: { active: false, configured: true },
    });
  });

  it("requires an explicit live flag and project binding before OpenAI can activate", () => {
    for (const name of ENV_NAMES) delete process.env[name];
    process.env.OPENAI_API_KEY = "synthetic-openai";

    expect(getIntegrationStatus()).toMatchObject({
      openai: { active: false, configured: false },
    });

    process.env.OPENAI_PROJECT_ID = "proj_synthetic_homerelay";
    expect(getIntegrationStatus()).toMatchObject({
      openai: { active: false, configured: true },
    });

    process.env.HOMERELAY_DEMO_MODE = "false";
    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "misconfigured",
      openai: { active: false, configured: true },
    });

    process.env.HOMERELAY_DATA_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable";
    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "supabase",
      openai: { active: true, configured: true },
    });

    process.env.HOMERELAY_E2E_ISOLATE_VENDORS = "true";
    expect(getIntegrationStatus()).toMatchObject({
      dataMode: "supabase",
      openai: { active: false, configured: true },
    });
  });
});
