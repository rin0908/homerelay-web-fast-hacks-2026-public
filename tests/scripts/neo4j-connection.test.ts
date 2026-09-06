import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

type ConnectionModule = Readonly<{
  isNeo4jLiveMode: (environment: Record<string, string>) => boolean;
  resolveNeo4jDatabase: (input: {
    explicitDatabase?: string;
    uri: URL;
    username: string;
  }) => string;
}>;

let connection: ConnectionModule;

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "scripts", "neo4j-connection.mjs"),
  ).href;
  connection = (await import(/* @vite-ignore */ moduleUrl)) as ConnectionModule;
});

describe("Neo4j script connection rules", () => {
  it("derives a matching current Aura Free instance ID", () => {
    expect(
      connection.resolveNeo4jDatabase({
        uri: new URL("neo4j+s://abcd1234.databases.neo4j.io"),
        username: "abcd1234",
      }),
    ).toBe("abcd1234");
  });

  it("always prioritizes an explicit database", () => {
    expect(
      connection.resolveNeo4jDatabase({
        explicitDatabase: "explicit-db",
        uri: new URL("neo4j+s://abcd1234.databases.neo4j.io"),
        username: "abcd1234",
      }),
    ).toBe("explicit-db");
  });

  it.each([
    ["http://127.0.0.1:7474", "abcd1234"],
    ["https://abcd1234.example.com", "abcd1234"],
    ["neo4j+s://wxyz5678.databases.neo4j.io", "abcd1234"],
    ["neo4j+s://abcd1234.databases.neo4j.io", "neo4j"],
  ])("keeps the legacy default for %s", (uri, username) => {
    expect(
      connection.resolveNeo4jDatabase({
        uri: new URL(uri),
        username,
      }),
    ).toBe("neo4j");
  });

  it.each([
    [
      {
        HOMERELAY_DATA_MODE: "supabase",
        HOMERELAY_DEMO_MODE: "false",
      },
      true,
    ],
    [
      {
        HOMERELAY_DATA_MODE: "supabase",
        HOMERELAY_DEMO_MODE: "true",
      },
      false,
    ],
    [{}, false],
    [
      {
        HOMERELAY_DATA_MODE: "demo",
        HOMERELAY_DEMO_MODE: "false",
      },
      false,
    ],
  ])("resolves live mode for %o", (environment, expected) => {
    expect(connection.isNeo4jLiveMode(environment)).toBe(expected);
  });

  it("disables live scripts when E2E vendor isolation is enabled", () => {
    expect(
      connection.isNeo4jLiveMode({
        HOMERELAY_DATA_MODE: "supabase",
        HOMERELAY_DEMO_MODE: "false",
        HOMERELAY_E2E_ISOLATE_VENDORS: "true",
      }),
    ).toBe(false);
  });
});
