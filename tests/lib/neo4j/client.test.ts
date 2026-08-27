import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createNeo4jClient,
  Neo4jQueryError,
} from "@/lib/neo4j/client";
import type { Neo4jConfig } from "@/lib/neo4j/env";

const CONFIG: Neo4jConfig = {
  database: "neo4j",
  password: "synthetic-password",
  queryApiUrl:
    "https://synthetic.databases.neo4j.io/db/neo4j/query/v2",
  timeoutMs: 4_000,
  username: "neo4j",
};

describe("Neo4j Query API client", () => {
  it("returns null when live credentials are unavailable", () => {
    expect(createNeo4jClient({ config: null })).toBeNull();
  });

  it("uses Basic auth and sends parameterized Cypher as plain JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { fields: ["entryId"], values: [["synthetic-entry"]] },
        }),
        { status: 202 },
      ),
    );
    const client = createNeo4jClient({ config: CONFIG, fetch: fetchMock });

    await expect(
      client?.execute("RETURN $entryId AS entryId", {
        entryId: "synthetic-entry",
      }),
    ).resolves.toEqual({
      fields: ["entryId"],
      values: [["synthetic-entry"]],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(CONFIG.queryApiUrl);
    expect(init).toMatchObject({
      cache: "no-store",
      method: "POST",
      redirect: "error",
    });
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from("neo4j:synthetic-password").toString("base64")}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      parameters: { entryId: "synthetic-entry" },
      statement: "RETURN $entryId AS entryId",
    });
    expect(String(init.body)).not.toContain(CONFIG.password);
  });

  it.each([
    [new Response("not-json", { status: 202 })],
    [
      new Response(
        JSON.stringify({
          errors: [{ message: "private vendor detail" }],
        }),
        { status: 202 },
      ),
    ],
    [
      new Response(JSON.stringify({ data: { fields: ["x"], values: [[]] } }), {
        status: 202,
      }),
    ],
    [new Response("private vendor detail", { status: 401 })],
  ])("maps malformed or failed vendor responses to a generic error", async (response) => {
    const client = createNeo4jClient({
      config: CONFIG,
      fetch: vi.fn().mockResolvedValue(response),
    });

    await expect(client?.execute("RETURN 1 AS x", {})).rejects.toEqual(
      new Neo4jQueryError(),
    );
  });

  it("rejects statements containing line breaks before any request", async () => {
    const fetchMock = vi.fn();
    const client = createNeo4jClient({ config: CONFIG, fetch: fetchMock });

    await expect(client?.execute("RETURN 1\nAS x", {})).rejects.toBeInstanceOf(
      Neo4jQueryError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
