import "server-only";

import { QdrantClient } from "@qdrant/js-client-rest";

import { getQdrantConfig, type QdrantConfig } from "@/lib/qdrant/env";

export type QdrantClientLike = Pick<QdrantClient, "query" | "upsert">;

export function createQdrantClient(
  config: QdrantConfig | null = getQdrantConfig(),
): QdrantClientLike | null {
  if (!config) return null;

  return new QdrantClient({
    apiKey: config.apiKey,
    checkCompatibility: true,
    timeout: config.timeoutMs,
    url: config.url,
  });
}
