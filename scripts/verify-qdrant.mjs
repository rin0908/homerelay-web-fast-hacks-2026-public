import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { QdrantClient } from "@qdrant/js-client-rest";

const DEFAULT_COLLECTION = "homerelay_entries";
const DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const DEFAULT_TIMEOUT_MS = 4_000;

const GENERIC_FAILURE_MESSAGE =
  "[verify-qdrant] FAIL: 接続、collection、Cloud Inference、世帯filter、またはcleanupを確認してください（詳細・認証情報は非表示）。";

function skip(logger, message) {
  logger.log(`[verify-qdrant] SKIP / 未接続: ${message}`);
}

function pass(logger, message) {
  logger.log(`[verify-qdrant] PASS ${message}`);
}

export function safeConfiguration(environment = process.env) {
  const urlValue = environment.QDRANT_URL?.trim();
  const apiKey = environment.QDRANT_API_KEY?.trim();
  if (!urlValue || !apiKey) return null;
  if (
    environment.HOMERELAY_DEMO_MODE?.trim().toLowerCase() === "true" ||
    environment.HOMERELAY_E2E_ISOLATE_VENDORS?.trim().toLowerCase() ===
      "true" ||
    environment.HOMERELAY_DATA_MODE?.trim().toLowerCase() !== "supabase"
  ) {
    return null;
  }

  let url;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("QDRANT_URL_INVALID");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new Error("QDRANT_URL_UNSAFE");
  }

  const collection =
    environment.QDRANT_COLLECTION?.trim() || DEFAULT_COLLECTION;
  const model = environment.QDRANT_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
  const timeoutValue = environment.QDRANT_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutValue
    ? Number.parseInt(timeoutValue, 10)
    : DEFAULT_TIMEOUT_MS;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(collection) ||
    !model ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 250 ||
    timeoutMs > 15_000
  ) {
    throw new Error("QDRANT_CONFIG_INVALID");
  }

  return {
    apiKey,
    collection,
    model,
    timeoutMs,
    url: url.toString().replace(/\/$/, ""),
  };
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function payloadIsScoped(point, householdId, type, currentEntryId) {
  const payload = point?.payload;
  return (
    payload &&
    payload.household_id === householdId &&
    payload.type === type &&
    payload.entry_id !== currentEntryId
  );
}

export async function verifyQdrantClient(
  client,
  config,
  { logger = console, randomUuid = randomUUID } = {},
) {
  const operationTimeout = Math.max(1, Math.ceil(config.timeoutMs / 1_000));
  const householdA = randomUuid();
  const householdB = randomUuid();
  const currentEntry = randomUuid();
  const relatedEntryA = randomUuid();
  const relatedEntryB = randomUuid();
  const pointIds = [randomUuid(), randomUuid(), randomUuid(), randomUuid()];
  const createdAt = new Date().toISOString();
  let cleanupRequired = false;
  let verificationError;

  try {
    const collection = await client.collectionExists(config.collection);
    assert(collection.exists, "COLLECTION_NOT_BOOTSTRAPPED");
    // Once the target collection is known to exist, an upsert can partially
    // succeed even when its request rejects. Always attempt one cleanup pass.
    cleanupRequired = true;

    await client.upsert(config.collection, {
      points: [
        {
          id: pointIds[0],
          vector: {
            text: "昼食後に水分を用意した合成申し送り",
            model: config.model,
          },
          payload: {
            household_id: householdA,
            entry_id: relatedEntryA,
            type: "handoff",
            created_at: createdAt,
            display_text: "合成世帯Aの過去の申し送り",
          },
        },
        {
          id: pointIds[1],
          vector: {
            text: "昼食後に水分を用意した合成申し送り",
            model: config.model,
          },
          payload: {
            household_id: householdB,
            entry_id: relatedEntryB,
            type: "handoff",
            created_at: createdAt,
            display_text: "合成世帯Bの過去の申し送り",
          },
        },
        {
          id: pointIds[2],
          vector: { text: "トイレットペーパー", model: config.model },
          payload: {
            household_id: householdA,
            entry_id: relatedEntryA,
            type: "needed_item",
            created_at: createdAt,
            display_text: "トイレットペーパー",
          },
        },
        {
          id: pointIds[3],
          vector: { text: "トイレットペーパー", model: config.model },
          payload: {
            household_id: householdB,
            entry_id: relatedEntryB,
            type: "needed_item",
            created_at: createdAt,
            display_text: "トイレットペーパー",
          },
        },
      ],
      timeout: operationTimeout,
      wait: true,
    });

    const query = async (type, text) =>
      client.query(config.collection, {
        filter: {
          must: [
            { key: "household_id", match: { value: householdA } },
            { key: "type", match: { value: type } },
          ],
          must_not: [
            { key: "entry_id", match: { value: currentEntry } },
          ],
        },
        limit: 3,
        query: { text, model: config.model },
        timeout: operationTimeout,
        with_payload: true,
        with_vector: false,
      });

    const handoffs = await query("handoff", "食事後の水分について");
    assert(
      handoffs.points.some((point) => point.id === pointIds[0]),
      "HANDOFF_RESULT_MISSING",
    );
    assert(
      handoffs.points.every((point) =>
        payloadIsScoped(point, householdA, "handoff", currentEntry),
      ),
      "HANDOFF_SCOPE_FAILED",
    );
    pass(logger, "Cloud Inferenceによる類似申し送り検索");

    const items = await query("needed_item", "トイレットペーパー");
    assert(
      items.points.some((point) => point.id === pointIds[2]),
      "ITEM_RESULT_MISSING",
    );
    assert(
      items.points.every((point) =>
        payloadIsScoped(point, householdA, "needed_item", currentEntry),
      ),
      "ITEM_SCOPE_FAILED",
    );
    pass(logger, "必要品重複候補と別世帯filter");
  } catch (error) {
    verificationError = error;
  }

  let cleanupError;
  if (cleanupRequired) {
    try {
      await client.delete(config.collection, {
        points: pointIds,
        timeout: operationTimeout,
        wait: true,
      });
      const residualPoints = await client.retrieve(config.collection, {
        ids: pointIds,
        timeout: operationTimeout,
        with_payload: false,
        with_vector: false,
      });
      assert(Array.isArray(residualPoints), "CLEANUP_READBACK_INVALID");
      assert(residualPoints.length === 0, "CLEANUP_RESIDUAL_POINTS");
      pass(logger, "検証pointの削除と0件read-back");
    } catch (error) {
      cleanupError = error;
    }
  }

  if (cleanupError) {
    throw new Error(
      verificationError
        ? "QDRANT_VERIFICATION_AND_CLEANUP_FAILED"
        : "QDRANT_CLEANUP_FAILED",
    );
  }
  if (verificationError) throw verificationError;
}

export async function runQdrantVerifier({
  Client = QdrantClient,
  environment = process.env,
  logger = console,
  randomUuid = randomUUID,
} = {}) {
  try {
    const config = safeConfiguration(environment);
    if (!config) {
      skip(
        logger,
        "明示的Supabase live modeとQDRANT_URL / QDRANT_API_KEYが揃っていないため外部通信していません。",
      );
      return 0;
    }

    const client = new Client({
      apiKey: config.apiKey,
      checkCompatibility: true,
      timeout: config.timeoutMs,
      url: config.url,
    });
    await verifyQdrantClient(client, config, { logger, randomUuid });
    return 0;
  } catch {
    logger.error(GENERIC_FAILURE_MESSAGE);
    return 1;
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  process.exitCode = await runQdrantVerifier();
}
