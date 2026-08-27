import "server-only";

import { Buffer } from "node:buffer";

import { getNeo4jConfig, type Neo4jConfig } from "@/lib/neo4j/env";

const MAX_RESPONSE_BYTES = 1_000_000;

export type Neo4jParameters = Readonly<Record<string, unknown>>;

export type Neo4jQueryResult = Readonly<{
  fields: readonly string[];
  values: readonly (readonly unknown[])[];
}>;

export type Neo4jClientLike = Readonly<{
  execute(
    statement: string,
    parameters: Neo4jParameters,
  ): Promise<Neo4jQueryResult>;
}>;

export class Neo4jQueryError extends Error {
  constructor() {
    super("Neo4j query failed");
    this.name = "Neo4jQueryError";
  }
}

type Neo4jFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseResponse(value: unknown): Neo4jQueryResult | null {
  if (!isRecord(value)) return null;
  if (Array.isArray(value.errors) && value.errors.length > 0) return null;
  if (!isRecord(value.data)) return null;

  const { fields, values } = value.data;
  if (
    !Array.isArray(fields) ||
    !fields.every((field) => typeof field === "string") ||
    !Array.isArray(values) ||
    !values.every(
      (row) => Array.isArray(row) && row.length === fields.length,
    )
  ) {
    return null;
  }

  return { fields, values };
}

function validStatement(statement: string): boolean {
  return (
    statement.length > 0 &&
    statement.length <= 20_000 &&
    !/[\r\n]/.test(statement)
  );
}

export function createNeo4jClient(options: {
  config?: Neo4jConfig | null;
  fetch?: Neo4jFetch;
} = {}): Neo4jClientLike | null {
  const config = options.config === undefined ? getNeo4jConfig() : options.config;
  if (!config) return null;

  const request = options.fetch ?? globalThis.fetch;
  const authorization = Buffer.from(
    `${config.username}:${config.password}`,
    "utf8",
  ).toString("base64");

  return {
    async execute(statement, parameters) {
      if (!validStatement(statement) || !isRecord(parameters)) {
        throw new Neo4jQueryError();
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      try {
        const response = await request(config.queryApiUrl, {
          body: JSON.stringify({ parameters, statement }),
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${authorization}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Neo4jQueryError();

        const body = await response.text();
        if (body.length > MAX_RESPONSE_BYTES) throw new Neo4jQueryError();

        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          throw new Neo4jQueryError();
        }

        const result = parseResponse(parsed);
        if (!result) throw new Neo4jQueryError();
        return result;
      } catch {
        throw new Neo4jQueryError();
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
