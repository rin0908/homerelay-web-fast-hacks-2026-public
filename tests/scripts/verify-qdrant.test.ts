import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

type VerifierModule = Readonly<{
  runQdrantVerifier: (options?: unknown) => Promise<number>;
  verifyQdrantClient: (
    client: unknown,
    config: unknown,
    options?: unknown,
  ) => Promise<void>;
}>;

const IDS = [
  "household-a",
  "household-b",
  "current-entry",
  "related-entry-a",
  "related-entry-b",
  "point-handoff-a",
  "point-handoff-b",
  "point-item-a",
  "point-item-b",
] as const;

const CONFIG = Object.freeze({
  apiKey: "qdrant-test-secret",
  collection: "homerelay_entries",
  model: "sentence-transformers/all-MiniLM-L6-v2",
  timeoutMs: 4_000,
  url: "https://homerelay.example.qdrant.io",
});

let verifier: VerifierModule;

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "scripts", "verify-qdrant.mjs"),
  ).href;
  verifier = (await import(/* @vite-ignore */ moduleUrl)) as VerifierModule;
});

function deterministicIds() {
  let index = 0;
  return vi.fn(() => IDS[index++] ?? `unexpected-id-${index}`);
}

function safeLogger() {
  return {
    error: vi.fn(),
    log: vi.fn(),
  };
}

function successfulClient() {
  return {
    collectionExists: vi.fn().mockResolvedValue({ exists: true }),
    delete: vi.fn().mockResolvedValue({ status: "completed" }),
    query: vi
      .fn()
      .mockResolvedValueOnce({
        points: [
          {
            id: IDS[5],
            payload: {
              entry_id: IDS[3],
              household_id: IDS[0],
              type: "handoff",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        points: [
          {
            id: IDS[7],
            payload: {
              entry_id: IDS[3],
              household_id: IDS[0],
              type: "needed_item",
            },
          },
        ],
      }),
    retrieve: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({ status: "completed" }),
  };
}

describe("Qdrant live verifier cleanup", () => {
  it("deletes every synthetic point and reads back zero before passing", async () => {
    const client = successfulClient();
    const logger = safeLogger();

    await expect(
      verifier.verifyQdrantClient(client, CONFIG, {
        logger,
        randomUuid: deterministicIds(),
      }),
    ).resolves.toBeUndefined();

    expect(client.delete).toHaveBeenCalledWith(CONFIG.collection, {
      points: IDS.slice(5),
      timeout: 4,
      wait: true,
    });
    expect(client.retrieve).toHaveBeenCalledWith(CONFIG.collection, {
      ids: IDS.slice(5),
      timeout: 4,
      with_payload: false,
      with_vector: false,
    });
    expect(client.delete.mock.invocationCallOrder[0]).toBeLessThan(
      client.retrieve.mock.invocationCallOrder[0],
    );
    expect(logger.log).toHaveBeenCalledWith(
      "[verify-qdrant] PASS 検証pointの削除と0件read-back",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("fails when deletion rejects and never claims cleanup success", async () => {
    const client = successfulClient();
    const logger = safeLogger();
    client.delete.mockRejectedValueOnce(new Error("vendor detail must stay private"));

    await expect(
      verifier.verifyQdrantClient(client, CONFIG, {
        logger,
        randomUuid: deterministicIds(),
      }),
    ).rejects.toThrow("QDRANT_CLEANUP_FAILED");

    expect(client.retrieve).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalledWith(
      expect.stringContaining("0件read-back"),
    );
  });

  it("fails when deletion read-back still contains a synthetic point", async () => {
    const client = successfulClient();
    client.retrieve.mockResolvedValueOnce([{ id: IDS[5] }]);

    await expect(
      verifier.verifyQdrantClient(client, CONFIG, {
        logger: safeLogger(),
        randomUuid: deterministicIds(),
      }),
    ).rejects.toThrow("QDRANT_CLEANUP_FAILED");
  });

  it("attempts one cleanup pass after a possibly partial upsert failure", async () => {
    const client = successfulClient();
    client.upsert.mockRejectedValueOnce(new Error("partial vendor failure"));

    await expect(
      verifier.verifyQdrantClient(client, CONFIG, {
        logger: safeLogger(),
        randomUuid: deterministicIds(),
      }),
    ).rejects.toThrow("partial vendor failure");

    expect(client.delete).toHaveBeenCalledTimes(1);
    expect(client.retrieve).toHaveBeenCalledTimes(1);
  });

  it("returns a fixed redacted failure while still cleaning up", async () => {
    const client = successfulClient();
    const logger = safeLogger();
    const secret = "qdrant-live-secret-never-log";
    client.query.mockReset();
    client.query.mockRejectedValueOnce(new Error(`vendor rejected ${secret}`));
    const Client = vi.fn(function ClientMock() {
      return client;
    });

    await expect(
      verifier.runQdrantVerifier({
        Client,
        environment: {
          HOMERELAY_DATA_MODE: "supabase",
          HOMERELAY_DEMO_MODE: "false",
          QDRANT_API_KEY: secret,
          QDRANT_URL: CONFIG.url,
        },
        logger,
        randomUuid: deterministicIds(),
      }),
    ).resolves.toBe(1);

    expect(client.delete).toHaveBeenCalledTimes(1);
    expect(client.retrieve).toHaveBeenCalledTimes(1);
    const output = [...logger.log.mock.calls, ...logger.error.mock.calls]
      .flat()
      .join(" ");
    expect(output).toContain("[verify-qdrant] FAIL");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("vendor rejected");
  });
});
