import { QdrantClient } from "@qdrant/js-client-rest";

const DEFAULT_COLLECTION = "homerelay_entries";
const DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const DEFAULT_VECTOR_SIZE = 384;
const DEFAULT_TIMEOUT_MS = 4_000;
const SCHEMA_VERSION = 1;

class SafeConfigError extends Error {}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new SafeConfigError(`${name} is required.`);
  return value;
}

function positiveInteger(name, fallback, maximum) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new SafeConfigError(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new SafeConfigError(`${name} is outside the supported range.`);
  }
  return parsed;
}

function qdrantUrl() {
  const raw = required("QDRANT_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeConfigError("QDRANT_URL must be a valid URL.");
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
    throw new SafeConfigError(
      "QDRANT_URL must use HTTPS, except for an explicit loopback URL.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function configuration() {
  if (process.env.HOMERELAY_DEMO_MODE?.trim().toLowerCase() === "true") {
    throw new SafeConfigError(
      "Disable HOMERELAY_DEMO_MODE before contacting Qdrant.",
    );
  }
  if (process.env.HOMERELAY_DATA_MODE?.trim().toLowerCase() !== "supabase") {
    throw new SafeConfigError(
      "Set HOMERELAY_DATA_MODE=supabase before contacting Qdrant.",
    );
  }

  const collection =
    process.env.QDRANT_COLLECTION?.trim() || DEFAULT_COLLECTION;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(collection)) {
    throw new SafeConfigError("QDRANT_COLLECTION is invalid.");
  }

  const embeddingModel =
    process.env.QDRANT_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  if (
    embeddingModel.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(embeddingModel)
  ) {
    throw new SafeConfigError("QDRANT_EMBEDDING_MODEL is invalid.");
  }

  return {
    apiKey: required("QDRANT_API_KEY"),
    collection,
    embeddingModel,
    timeoutMs: positiveInteger("QDRANT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 15_000),
    url: qdrantUrl(),
    vectorSize: positiveInteger(
      "QDRANT_VECTOR_SIZE",
      DEFAULT_VECTOR_SIZE,
      65_536,
    ),
  };
}

function verifyCollection(info, config) {
  const vectors = info?.config?.params?.vectors;
  if (
    !vectors ||
    typeof vectors !== "object" ||
    !("size" in vectors) ||
    vectors.size !== config.vectorSize ||
    vectors.distance !== "Cosine"
  ) {
    throw new SafeConfigError(
      "Existing collection vector configuration does not match the requested model.",
    );
  }

  const metadata = info?.config?.metadata;
  if (
    metadata?.application !== "HomeRelay" ||
    metadata?.schema_version !== SCHEMA_VERSION ||
    metadata?.embedding_model !== config.embeddingModel
  ) {
    throw new SafeConfigError(
      "Existing collection metadata does not match this HomeRelay schema/model.",
    );
  }
}

async function bootstrap() {
  const config = configuration();
  const client = new QdrantClient({
    apiKey: config.apiKey,
    checkCompatibility: true,
    timeout: config.timeoutMs,
    url: config.url,
  });
  const operationTimeout = Math.max(1, Math.ceil(config.timeoutMs / 1_000));
  const existence = await client.collectionExists(config.collection);

  if (!existence.exists) {
    await client.createCollection(config.collection, {
      metadata: {
        application: "HomeRelay",
        embedding_model: config.embeddingModel,
        schema_version: SCHEMA_VERSION,
      },
      timeout: operationTimeout,
      vectors: { distance: "Cosine", size: config.vectorSize },
    });
  }

  let info = await client.getCollection(config.collection);
  verifyCollection(info, config);

  const indexes = [
    ["household_id", "uuid"],
    ["entry_id", "uuid"],
    ["type", "keyword"],
    ["created_at", "datetime"],
  ];
  for (const [fieldName, fieldSchema] of indexes) {
    if (info.payload_schema[fieldName]) continue;
    await client.createPayloadIndex(config.collection, {
      field_name: fieldName,
      field_schema: fieldSchema,
      timeout: operationTimeout,
      wait: true,
    });
    info = await client.getCollection(config.collection);
  }

  console.log(
    `Qdrant collection ready: ${config.collection} (${config.embeddingModel}, ${config.vectorSize} dimensions).`,
  );
}

try {
  await bootstrap();
} catch (error) {
  if (error instanceof SafeConfigError) console.error(error.message);
  else console.error("Qdrant bootstrap failed without exposing vendor details.");
  process.exitCode = 1;
}
