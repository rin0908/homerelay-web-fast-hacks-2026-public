import "server-only";

export const DEFAULT_QDRANT_COLLECTION = "homerelay_entries";
export const DEFAULT_QDRANT_EMBEDDING_MODEL =
  "sentence-transformers/all-MiniLM-L6-v2";
export const DEFAULT_QDRANT_VECTOR_SIZE = 384;
export const DEFAULT_QDRANT_TIMEOUT_MS = 4_000;

const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 15_000;
const MAX_VECTOR_SIZE = 65_536;

export type QdrantEnvironment = {
  HOMERELAY_DATA_MODE?: string;
  HOMERELAY_DEMO_MODE?: string;
  QDRANT_API_KEY?: string;
  QDRANT_COLLECTION?: string;
  QDRANT_EMBEDDING_MODEL?: string;
  QDRANT_TIMEOUT_MS?: string;
  QDRANT_URL?: string;
  QDRANT_VECTOR_SIZE?: string;
};

export type QdrantConfig = Readonly<{
  apiKey: string;
  collection: string;
  embeddingModel: string;
  timeoutMs: number;
  url: string;
  vectorSize: number;
}>;

function currentEnvironment(): QdrantEnvironment {
  return {
    HOMERELAY_DATA_MODE: process.env.HOMERELAY_DATA_MODE,
    HOMERELAY_DEMO_MODE: process.env.HOMERELAY_DEMO_MODE,
    QDRANT_API_KEY: process.env.QDRANT_API_KEY,
    QDRANT_COLLECTION: process.env.QDRANT_COLLECTION,
    QDRANT_EMBEDDING_MODEL: process.env.QDRANT_EMBEDDING_MODEL,
    QDRANT_TIMEOUT_MS: process.env.QDRANT_TIMEOUT_MS,
    QDRANT_URL: process.env.QDRANT_URL,
    QDRANT_VECTOR_SIZE: process.env.QDRANT_VECTOR_SIZE,
  };
}

function isExplicitLiveMode(environment: QdrantEnvironment): boolean {
  const forcedDemo =
    environment.HOMERELAY_DEMO_MODE?.trim().toLowerCase() === "true";
  const dataMode = environment.HOMERELAY_DATA_MODE?.trim().toLowerCase();
  return !forcedDemo && dataMode === "supabase";
}

function parseHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const isLoopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";

    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback))
    ) {
      return null;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function validCollection(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function validModel(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function getQdrantConfig(
  environment: QdrantEnvironment = currentEnvironment(),
): QdrantConfig | null {
  if (!isExplicitLiveMode(environment)) return null;

  const apiKey = environment.QDRANT_API_KEY?.trim() ?? "";
  const collection =
    environment.QDRANT_COLLECTION?.trim() || DEFAULT_QDRANT_COLLECTION;
  const embeddingModel =
    environment.QDRANT_EMBEDDING_MODEL?.trim() ||
    DEFAULT_QDRANT_EMBEDDING_MODEL;
  const url = parseHttpUrl(environment.QDRANT_URL?.trim() ?? "");
  const timeoutMs = parseInteger(
    environment.QDRANT_TIMEOUT_MS,
    DEFAULT_QDRANT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const vectorSize = parseInteger(
    environment.QDRANT_VECTOR_SIZE,
    DEFAULT_QDRANT_VECTOR_SIZE,
    1,
    MAX_VECTOR_SIZE,
  );

  if (
    !apiKey ||
    !url ||
    timeoutMs === null ||
    vectorSize === null ||
    !validCollection(collection) ||
    !validModel(embeddingModel)
  ) {
    return null;
  }

  return Object.freeze({
    apiKey,
    collection,
    embeddingModel,
    timeoutMs,
    url,
    vectorSize,
  });
}

export function isQdrantConfigured(
  environment?: QdrantEnvironment,
): boolean {
  return getQdrantConfig(environment) !== null;
}
