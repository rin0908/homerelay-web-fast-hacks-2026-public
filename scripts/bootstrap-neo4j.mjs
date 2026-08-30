import { Buffer } from "node:buffer";

import {
  isNeo4jLiveMode,
  resolveNeo4jDatabase,
} from "./neo4j-connection.mjs";
import {
  applyNeo4jSchema,
  NEO4J_SCHEMA_CONSTRAINTS,
} from "./neo4j-schema.mjs";

const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const VERIFY_CONSTRAINTS =
  "SHOW CONSTRAINTS YIELD name WHERE name IN $names RETURN collect(name) AS names";

function skip(message) {
  console.log(`[bootstrap-neo4j] SKIP / 未接続: ${message}`);
}

function pass(message) {
  console.log(`[bootstrap-neo4j] PASS ${message}`);
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function configuration(environment = process.env) {
  const uriValue = environment.NEO4J_URI?.trim();
  const username = environment.NEO4J_USERNAME?.trim();
  const password = environment.NEO4J_PASSWORD;
  if (!uriValue || !username || !password) return null;
  if (!isNeo4jLiveMode(environment)) return null;

  const timeoutText = environment.NEO4J_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutText ? Number(timeoutText) : DEFAULT_TIMEOUT_MS;
  if (
    username.includes(":") ||
    /[\u0000-\u001f\u007f]/.test(username) ||
    /[\u0000-\u001f\u007f]/.test(password) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 250 ||
    timeoutMs > 15_000
  ) {
    throw new Error("NEO4J_CONFIG_INVALID");
  }

  let uri;
  try {
    uri = new URL(uriValue);
  } catch {
    throw new Error("NEO4J_URI_INVALID");
  }
  const loopback =
    uri.hostname === "localhost" ||
    uri.hostname === "127.0.0.1" ||
    uri.hostname === "[::1]";
  if (
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash ||
    (uri.pathname !== "" && uri.pathname !== "/") ||
    ![
      "https:",
      "neo4j+s:",
      ...(loopback ? ["http:"] : []),
    ].includes(uri.protocol)
  ) {
    throw new Error("NEO4J_URI_UNSAFE");
  }

  const database = resolveNeo4jDatabase({
    explicitDatabase: environment.NEO4J_DATABASE,
    uri,
    username,
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(database)) {
    throw new Error("NEO4J_CONFIG_INVALID");
  }

  const origin =
    uri.protocol === "neo4j+s:"
      ? `https://${uri.host}`
      : uri.toString().replace(/\/$/, "");
  return {
    authorization: Buffer.from(`${username}:${password}`, "utf8").toString(
      "base64",
    ),
    endpoint: `${origin}/db/${encodeURIComponent(database)}/query/v2`,
    timeoutMs,
  };
}

async function execute(config, statement, parameters) {
  assert(
    typeof statement === "string" &&
      statement.length > 0 &&
      statement.length <= 20_000 &&
      !/[\r\n]/.test(statement),
    "STATEMENT_INVALID",
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.endpoint, {
      body: JSON.stringify({ statement, parameters }),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${config.authorization}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
    assert(response.ok, "QUERY_HTTP_ERROR");
    const text = await response.text();
    assert(text.length <= MAX_RESPONSE_BYTES, "QUERY_RESPONSE_TOO_LARGE");
    const body = JSON.parse(text);
    assert(
      body &&
        typeof body === "object" &&
        (!Array.isArray(body.errors) || body.errors.length === 0) &&
        body.data &&
        Array.isArray(body.data.fields) &&
        Array.isArray(body.data.values),
      "QUERY_RESPONSE_INVALID",
    );
    return body.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function bootstrap() {
  const config = configuration();
  if (!config) {
    skip(
      "明示的Supabase live modeとNEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORDが揃っていないため外部通信していません。",
    );
    return;
  }

  const count = await applyNeo4jSchema((statement, parameters) =>
    execute(config, statement, parameters),
  );
  const expectedNames = NEO4J_SCHEMA_CONSTRAINTS.map(({ name }) => name);
  const result = await execute(config, VERIFY_CONSTRAINTS, {
    names: expectedNames,
  });
  assert(
    result.fields.length === 1 &&
      result.fields[0] === "names" &&
      result.values.length === 1 &&
      Array.isArray(result.values[0]?.[0]) &&
      expectedNames.every((name) => result.values[0][0].includes(name)),
    "CONSTRAINT_READBACK_FAILED",
  );
  pass(`${count}件のHomeRelay uniqueness constraintをread-back確認`);
}

try {
  await bootstrap();
} catch {
  console.error(
    "[bootstrap-neo4j] FAIL: Query API接続、schema権限、既存データ重複、またはconstraint read-backを確認してください（詳細・認証情報は非表示）。",
  );
  process.exitCode = 1;
}
