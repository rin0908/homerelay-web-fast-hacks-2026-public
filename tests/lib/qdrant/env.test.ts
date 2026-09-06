import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_QDRANT_COLLECTION,
  DEFAULT_QDRANT_EMBEDDING_MODEL,
  DEFAULT_QDRANT_TIMEOUT_MS,
  DEFAULT_QDRANT_VECTOR_SIZE,
  getQdrantConfig,
  isQdrantConfigured,
  type QdrantEnvironment,
} from "@/lib/qdrant/env";

const LIVE_ENVIRONMENT: QdrantEnvironment = {
  HOMERELAY_DATA_MODE: "supabase",
  HOMERELAY_DEMO_MODE: "false",
  QDRANT_API_KEY: "synthetic-database-key",
  QDRANT_URL: "https://synthetic-cluster.qdrant.io",
};

describe("Qdrant environment", () => {
  it("returns a trimmed live configuration with explicit safe defaults", () => {
    const config = getQdrantConfig({
      ...LIVE_ENVIRONMENT,
      QDRANT_API_KEY: "  synthetic-database-key  ",
      QDRANT_URL: "  https://synthetic-cluster.qdrant.io/  ",
    });

    expect(config).toEqual({
      apiKey: "synthetic-database-key",
      collection: DEFAULT_QDRANT_COLLECTION,
      embeddingModel: DEFAULT_QDRANT_EMBEDDING_MODEL,
      timeoutMs: DEFAULT_QDRANT_TIMEOUT_MS,
      url: "https://synthetic-cluster.qdrant.io",
      vectorSize: DEFAULT_QDRANT_VECTOR_SIZE,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("allows an HTTP endpoint only on an explicit loopback host", () => {
    expect(
      getQdrantConfig({
        ...LIVE_ENVIRONMENT,
        QDRANT_URL: "http://127.0.0.1:6333",
      }),
    ).toMatchObject({ url: "http://127.0.0.1:6333" });

    expect(
      getQdrantConfig({
        ...LIVE_ENVIRONMENT,
        QDRANT_URL: "http://qdrant.internal:6333",
      }),
    ).toBeNull();
  });

  it.each([
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DATA_MODE: "demo" }],
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DATA_MODE: undefined }],
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DEMO_MODE: " TRUE " }],
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_E2E_ISOLATE_VENDORS: "true" }],
  ])("never enables Qdrant outside explicit authenticated data mode", (environment) => {
    expect(getQdrantConfig(environment)).toBeNull();
    expect(isQdrantConfigured(environment)).toBe(false);
  });

  it.each([
    [{ ...LIVE_ENVIRONMENT, QDRANT_API_KEY: "" }],
    [{ ...LIVE_ENVIRONMENT, QDRANT_URL: "" }],
    [{ ...LIVE_ENVIRONMENT, QDRANT_URL: "not-a-url" }],
    [
      {
        ...LIVE_ENVIRONMENT,
        QDRANT_URL: "https://username:password@synthetic.qdrant.io",
      },
    ],
    [{ ...LIVE_ENVIRONMENT, QDRANT_COLLECTION: "bad/collection" }],
    [{ ...LIVE_ENVIRONMENT, QDRANT_EMBEDDING_MODEL: "bad\nmodel" }],
    [{ ...LIVE_ENVIRONMENT, QDRANT_TIMEOUT_MS: "249" }],
    [{ ...LIVE_ENVIRONMENT, QDRANT_TIMEOUT_MS: "15001" }],
    [{ ...LIVE_ENVIRONMENT, QDRANT_VECTOR_SIZE: "0" }],
    [{ ...LIVE_ENVIRONMENT, QDRANT_VECTOR_SIZE: "not-a-number" }],
  ])("rejects incomplete or unsafe configuration", (environment) => {
    expect(getQdrantConfig(environment)).toBeNull();
  });

  it("accepts explicit model, collection, dimension, and timeout configuration", () => {
    expect(
      getQdrantConfig({
        ...LIVE_ENVIRONMENT,
        QDRANT_COLLECTION: "homerelay_entries_v2",
        QDRANT_EMBEDDING_MODEL: "synthetic/multilingual-model",
        QDRANT_TIMEOUT_MS: "2500",
        QDRANT_VECTOR_SIZE: "768",
      }),
    ).toMatchObject({
      collection: "homerelay_entries_v2",
      embeddingModel: "synthetic/multilingual-model",
      timeoutMs: 2_500,
      vectorSize: 768,
    });
  });
});
