import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isNeo4jLiveMode,
  resolveNeo4jDatabase,
} from "./neo4j-connection.mjs";

const DEFAULT_TIMEOUT_MS = 4_000;

function skip(logger, message) {
  logger.log(`[verify-neo4j] SKIP / 未接続: ${message}`);
}

function pass(logger, message) {
  logger.log(`[verify-neo4j] PASS ${message}`);
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
    !username ||
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
  assert(!/[\r\n]/.test(statement), "STATEMENT_LINE_BREAK");
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
    const body = await response.json();
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

const WRITE_GRAPH = [
  "MERGE (household:HomeRelayHousehold {id: $householdId})",
  "MERGE (family:HomeRelayMember {id: $familyId, householdId: $householdId}) SET family.role = 'family' MERGE (family)-[:MEMBER_OF]->(household)",
  "MERGE (relative:HomeRelayMember {id: $relativeId, householdId: $householdId}) SET relative.role = 'relative' MERGE (relative)-[:MEMBER_OF]->(household)",
  "MERGE (helper:HomeRelayMember {id: $helperId, householdId: $householdId}) SET helper.role = 'helper' MERGE (helper)-[:MEMBER_OF]->(household)",
  "MERGE (handoff:HomeRelayHandoff {id: $entryId, householdId: $householdId}) SET handoff.status = 'done', handoff.statusRank = 3 MERGE (handoff)-[:BELONGS_TO]->(household) MERGE (helper)-[:AUTHORED]->(handoff)",
  "MERGE (relative)-[:HANDOFF_ACTION {eventKey: $confirmationKey}]->(handoff) MERGE (family)-[:ASSIGNED_TO]->(handoff)",
  "MERGE (item:HomeRelayNeededItem {id: $itemId, householdId: $householdId}) SET item.entryId = $entryId, item.state = 'purchased', item.stateRank = 3 MERGE (handoff)-[:NEEDS]->(item) MERGE (family)-[:PURCHASE_ASSIGNEE]->(item) MERGE (family)-[:PURCHASE_ACTION {eventKey: $purchaseKey}]->(item)",
  "RETURN handoff.id AS entryId, item.id AS itemId",
].join(" ");

const WRITE_FOREIGN_GRAPH = [
  "MERGE (household:HomeRelayHousehold {id: $foreignHouseholdId})",
  "MERGE (helper:HomeRelayMember {id: $foreignHelperId, householdId: $foreignHouseholdId}) SET helper.role = 'helper' MERGE (helper)-[:MEMBER_OF]->(household)",
  "MERGE (handoff:HomeRelayHandoff {id: $foreignEntryId, householdId: $foreignHouseholdId}) SET handoff.status = 'confirmed', handoff.statusRank = 1 MERGE (handoff)-[:BELONGS_TO]->(household) MERGE (helper)-[:AUTHORED]->(handoff)",
  "RETURN handoff.id AS entryId",
].join(" ");

const READ_GRAPH = [
  "MATCH (household:HomeRelayHousehold {id: $householdId})<-[:BELONGS_TO]-(handoff:HomeRelayHandoff {id: $entryId})<-[:AUTHORED]-(helper:HomeRelayMember {role: 'helper'})",
  "MATCH (relative:HomeRelayMember {role: 'relative'})-[:HANDOFF_ACTION]->(handoff)",
  "MATCH (family:HomeRelayMember {role: 'family'})-[:ASSIGNED_TO]->(handoff)-[:NEEDS]->(item:HomeRelayNeededItem {id: $itemId})",
  "MATCH (family)-[:PURCHASE_ASSIGNEE]->(item)<-[:PURCHASE_ACTION]-(family)",
  "RETURN helper.role AS authorRole, relative.role AS confirmerRole, family.role AS assigneeRole, handoff.status AS handoffStatus, item.state AS itemState",
].join(" ");

const READ_FOREIGN_SCOPE = [
  "MATCH (household:HomeRelayHousehold {id: $householdId})<-[:BELONGS_TO]-(handoff:HomeRelayHandoff {id: $foreignEntryId})<-[:AUTHORED]-(helper:HomeRelayMember)",
  "WHERE handoff.householdId = $householdId AND helper.householdId = $householdId",
  "RETURN count(handoff) AS foreignRelationCount",
].join(" ");

const CLEAN_GRAPH = [
  "MATCH (node)",
  "WHERE (node:HomeRelayHousehold AND node.id = $householdId) OR node.householdId = $householdId",
  "DETACH DELETE node",
].join(" ");

const READ_CLEANUP = [
  "OPTIONAL MATCH (node)",
  "WHERE (node:HomeRelayHousehold AND node.id = $householdId) OR node.householdId = $householdId",
  "WITH collect(node) AS nodes",
  "OPTIONAL MATCH (source)-[relationship]-(target)",
  "WHERE source IN nodes OR target IN nodes",
  "RETURN size(nodes) AS nodeCount, count(DISTINCT relationship) AS relationshipCount",
].join(" ");

export async function verifyNeo4jExecutor(
  executor,
  { logger = console, randomUuid = randomUUID } = {},
) {
  const ids = {
    confirmationKey: randomUuid(),
    entryId: randomUuid(),
    familyId: randomUuid(),
    foreignEntryId: randomUuid(),
    foreignHelperId: randomUuid(),
    foreignHouseholdId: randomUuid(),
    helperId: randomUuid(),
    householdId: randomUuid(),
    itemId: randomUuid(),
    purchaseKey: randomUuid(),
    relativeId: randomUuid(),
  };
  let cleanupRequired = false;
  let verificationError;

  try {
    // Query API transport failures can be ambiguous after the server commits.
    // Mark this run for one scoped cleanup pass before the first write starts.
    cleanupRequired = true;
    const written = await executor(WRITE_GRAPH, ids);
    assert(written.values.length === 1, "GRAPH_WRITE_NOT_OBSERVED");
    pass(logger, "合成HomeRelay関係グラフのparameterized write");

    const foreignWritten = await executor(WRITE_FOREIGN_GRAPH, ids);
    assert(
      foreignWritten.values.length === 1,
      "FOREIGN_GRAPH_WRITE_NOT_OBSERVED",
    );
    pass(logger, "別世帯の合成関係グラフのparameterized write");

    const read = await executor(READ_GRAPH, ids);
    assert(read.values.length === 1, "GRAPH_READ_NOT_OBSERVED");
    assert(
      JSON.stringify(read.values[0]) ===
        JSON.stringify(["helper", "relative", "family", "done", "purchased"]),
      "GRAPH_RELATION_MISMATCH",
    );
    pass(
      logger,
      "家族・親族・ヘルパー・申し送り・担当・購入関係のread-back",
    );

    const foreignScope = await executor(READ_FOREIGN_SCOPE, ids);
    assert(
      foreignScope.fields.length === 1 &&
        foreignScope.fields[0] === "foreignRelationCount" &&
        foreignScope.values.length === 1 &&
        Array.isArray(foreignScope.values[0]) &&
        foreignScope.values[0][0] === 0,
      "FOREIGN_HOUSEHOLD_SCOPE_FAILED",
    );
    pass(logger, "HomeRelay household filterで別世帯関係0件read-back");
  } catch (error) {
    verificationError = error;
  }

  let cleanupFailed = false;
  if (cleanupRequired) {
    for (const householdId of [ids.householdId, ids.foreignHouseholdId]) {
      try {
        await executor(CLEAN_GRAPH, { householdId });
      } catch {
        cleanupFailed = true;
      }

      try {
        const residual = await executor(READ_CLEANUP, { householdId });
        assert(
          residual.fields.length === 2 &&
            residual.fields[0] === "nodeCount" &&
            residual.fields[1] === "relationshipCount" &&
            residual.values.length === 1 &&
            Array.isArray(residual.values[0]) &&
            residual.values[0][0] === 0 &&
            residual.values[0][1] === 0,
          "CLEANUP_RESIDUAL_GRAPH",
        );
      } catch {
        cleanupFailed = true;
      }
    }

    if (!cleanupFailed) {
      pass(
        logger,
        "HomeRelay / 別世帯の合成graphを削除し両世帯node / relationship 0件read-back",
      );
    }
  }

  if (cleanupFailed) {
    throw new Error(
      verificationError
        ? "NEO4J_VERIFICATION_AND_CLEANUP_FAILED"
        : "NEO4J_CLEANUP_FAILED",
    );
  }
  if (verificationError) throw verificationError;
}

export async function runNeo4jVerifier({
  environment = process.env,
  logger = console,
} = {}) {
  try {
    const config = configuration(environment);
    if (!config) {
      skip(
        logger,
        "明示的Supabase live modeとNEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORDが揃っていないため外部通信していません。",
      );
      return 0;
    }

    await verifyNeo4jExecutor(
      (statement, parameters) => execute(config, statement, parameters),
      { logger },
    );
    return 0;
  } catch {
    logger.error(
      "[verify-neo4j] FAIL: Query API接続、認証、関係グラフread-back、またはcleanupを確認してください（詳細・認証情報は非表示）。",
    );
    return 1;
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  process.exitCode = await runNeo4jVerifier();
}
