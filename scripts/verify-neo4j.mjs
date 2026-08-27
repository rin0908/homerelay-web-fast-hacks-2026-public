import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

const DEFAULT_DATABASE = "neo4j";
const DEFAULT_TIMEOUT_MS = 4_000;

function skip(message) {
  console.log(`[verify-neo4j] SKIP / 未接続: ${message}`);
}

function pass(message) {
  console.log(`[verify-neo4j] PASS ${message}`);
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function configuration() {
  const uriValue = process.env.NEO4J_URI?.trim();
  const username = process.env.NEO4J_USERNAME?.trim();
  const password = process.env.NEO4J_PASSWORD;
  if (!uriValue || !username || !password) return null;
  if (
    process.env.HOMERELAY_DEMO_MODE?.trim().toLowerCase() === "true" ||
    process.env.HOMERELAY_DATA_MODE?.trim().toLowerCase() !== "supabase"
  ) {
    return null;
  }

  const database = process.env.NEO4J_DATABASE?.trim() || DEFAULT_DATABASE;
  const timeoutText = process.env.NEO4J_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutText ? Number(timeoutText) : DEFAULT_TIMEOUT_MS;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(database) ||
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

const READ_GRAPH = [
  "MATCH (household:HomeRelayHousehold {id: $householdId})<-[:BELONGS_TO]-(handoff:HomeRelayHandoff {id: $entryId})<-[:AUTHORED]-(helper:HomeRelayMember {role: 'helper'})",
  "MATCH (relative:HomeRelayMember {role: 'relative'})-[:HANDOFF_ACTION]->(handoff)",
  "MATCH (family:HomeRelayMember {role: 'family'})-[:ASSIGNED_TO]->(handoff)-[:NEEDS]->(item:HomeRelayNeededItem {id: $itemId})",
  "MATCH (family)-[:PURCHASE_ASSIGNEE]->(item)<-[:PURCHASE_ACTION]-(family)",
  "RETURN helper.role AS authorRole, relative.role AS confirmerRole, family.role AS assigneeRole, handoff.status AS handoffStatus, item.state AS itemState",
].join(" ");

const CLEAN_GRAPH = [
  "MATCH (household:HomeRelayHousehold {id: $householdId})",
  "OPTIONAL MATCH (node) WHERE node.householdId = $householdId",
  "DETACH DELETE node, household",
].join(" ");

async function verify() {
  const config = configuration();
  if (!config) {
    skip(
      "明示的Supabase live modeとNEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORDが揃っていないため外部通信していません。",
    );
    return;
  }

  const ids = {
    confirmationKey: randomUUID(),
    entryId: randomUUID(),
    familyId: randomUUID(),
    helperId: randomUUID(),
    householdId: randomUUID(),
    itemId: randomUUID(),
    purchaseKey: randomUUID(),
    relativeId: randomUUID(),
  };
  let created = false;

  try {
    const written = await execute(config, WRITE_GRAPH, ids);
    assert(written.values.length === 1, "GRAPH_WRITE_NOT_OBSERVED");
    created = true;
    pass("合成HomeRelay関係グラフのparameterized write");

    const read = await execute(config, READ_GRAPH, ids);
    assert(read.values.length === 1, "GRAPH_READ_NOT_OBSERVED");
    assert(
      JSON.stringify(read.values[0]) ===
        JSON.stringify(["helper", "relative", "family", "done", "purchased"]),
      "GRAPH_RELATION_MISMATCH",
    );
    pass("家族・親族・ヘルパー・申し送り・担当・購入関係のread-back");
  } finally {
    if (created) {
      await execute(config, CLEAN_GRAPH, { householdId: ids.householdId });
      pass("この実行で作成した合成householdだけをcleanup");
    }
  }
}

try {
  await verify();
} catch {
  console.error(
    "[verify-neo4j] FAIL: Query API接続、認証、または関係グラフread-backを確認してください（詳細・認証情報は非表示）。",
  );
  process.exitCode = 1;
}
