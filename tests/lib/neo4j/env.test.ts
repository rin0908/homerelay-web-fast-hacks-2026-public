import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_NEO4J_DATABASE,
  DEFAULT_NEO4J_TIMEOUT_MS,
  getNeo4jConfig,
  isNeo4jConfigured,
  type Neo4jEnvironment,
} from "@/lib/neo4j/env";

const LIVE_ENVIRONMENT: Neo4jEnvironment = {
  HOMERELAY_DATA_MODE: "supabase",
  HOMERELAY_DEMO_MODE: "false",
  NEO4J_PASSWORD: "synthetic-password",
  NEO4J_URI: "neo4j+s://synthetic.databases.neo4j.io",
  NEO4J_USERNAME: "neo4j",
};

describe("Neo4j environment", () => {
  it("derives the TLS Query API endpoint from an Aura connection URI", () => {
    const config = getNeo4jConfig(LIVE_ENVIRONMENT);

    expect(config).toEqual({
      database: DEFAULT_NEO4J_DATABASE,
      password: "synthetic-password",
      queryApiUrl:
        "https://synthetic.databases.neo4j.io/db/neo4j/query/v2",
      timeoutMs: DEFAULT_NEO4J_TIMEOUT_MS,
      username: "neo4j",
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("permits HTTP only for an explicit loopback development server", () => {
    expect(
      getNeo4jConfig({
        ...LIVE_ENVIRONMENT,
        NEO4J_URI: "http://127.0.0.1:7474",
      }),
    ).toMatchObject({
      queryApiUrl: "http://127.0.0.1:7474/db/neo4j/query/v2",
    });
    expect(
      getNeo4jConfig({
        ...LIVE_ENVIRONMENT,
        NEO4J_URI: "http://neo4j.internal:7474",
      }),
    ).toBeNull();
  });

  it.each([
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DATA_MODE: "demo" }],
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DATA_MODE: undefined }],
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DEMO_MODE: " TRUE " }],
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_E2E_ISOLATE_VENDORS: "true" }],
  ])("never enables Neo4j outside explicit authenticated data mode", (environment) => {
    expect(getNeo4jConfig(environment)).toBeNull();
    expect(isNeo4jConfigured(environment)).toBe(false);
  });

  it.each([
    [{ ...LIVE_ENVIRONMENT, NEO4J_URI: "" }],
    [{ ...LIVE_ENVIRONMENT, NEO4J_USERNAME: "" }],
    [{ ...LIVE_ENVIRONMENT, NEO4J_PASSWORD: "" }],
    [{ ...LIVE_ENVIRONMENT, NEO4J_URI: "bolt://synthetic:7687" }],
    [
      {
        ...LIVE_ENVIRONMENT,
        NEO4J_URI: "https://user:pass@synthetic.databases.neo4j.io",
      },
    ],
    [
      {
        ...LIVE_ENVIRONMENT,
        NEO4J_URI: "https://synthetic.databases.neo4j.io/private",
      },
    ],
    [{ ...LIVE_ENVIRONMENT, NEO4J_DATABASE: "bad/database" }],
    [{ ...LIVE_ENVIRONMENT, NEO4J_USERNAME: "bad:user" }],
    [{ ...LIVE_ENVIRONMENT, NEO4J_TIMEOUT_MS: "249" }],
    [{ ...LIVE_ENVIRONMENT, NEO4J_TIMEOUT_MS: "15001" }],
  ])("rejects incomplete or unsafe configuration", (environment) => {
    expect(getNeo4jConfig(environment)).toBeNull();
  });

  it("accepts a custom database and bounded timeout", () => {
    expect(
      getNeo4jConfig({
        ...LIVE_ENVIRONMENT,
        NEO4J_DATABASE: "homerelay",
        NEO4J_TIMEOUT_MS: "2500",
        NEO4J_URI: "https://synthetic.databases.neo4j.io/",
      }),
    ).toMatchObject({
      database: "homerelay",
      queryApiUrl:
        "https://synthetic.databases.neo4j.io/db/homerelay/query/v2",
      timeoutMs: 2_500,
    });
  });
});
