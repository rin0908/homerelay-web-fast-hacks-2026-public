import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  query: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: class QdrantClientMock {
    query = mocks.query;
    upsert = mocks.upsert;

    constructor(options: unknown) {
      mocks.constructor(options);
    }
  },
}));

import { createQdrantClient } from "@/lib/qdrant/client";
import type { QdrantConfig } from "@/lib/qdrant/env";

const CONFIG: QdrantConfig = {
  apiKey: "synthetic-database-key",
  collection: "homerelay_entries",
  embeddingModel: "synthetic/model",
  timeoutMs: 3_250,
  url: "https://synthetic.qdrant.io",
  vectorSize: 384,
};

describe("Qdrant client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not construct an SDK client without valid configuration", () => {
    expect(createQdrantClient(null)).toBeNull();
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it("keeps credentials server-side and applies the local abort timeout", () => {
    const client = createQdrantClient(CONFIG);

    expect(client).not.toBeNull();
    expect(mocks.constructor).toHaveBeenCalledWith({
      apiKey: "synthetic-database-key",
      checkCompatibility: true,
      timeout: 3_250,
      url: "https://synthetic.qdrant.io",
    });
  });
});
