import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

type QueryResult = Readonly<{
  fields: string[];
  values: unknown[][];
}>;

type Executor = (
  statement: string,
  parameters: Record<string, string>,
) => Promise<QueryResult>;

type VerifierModule = Readonly<{
  runNeo4jVerifier: (options?: unknown) => Promise<number>;
  verifyNeo4jExecutor: (
    executor: Executor,
    options?: unknown,
  ) => Promise<void>;
}>;

const IDS = [
  "confirmation-key",
  "entry-id",
  "family-id",
  "foreign-entry-id",
  "foreign-helper-id",
  "foreign-household-id",
  "helper-id",
  "household-id",
  "item-id",
  "purchase-key",
  "relative-id",
] as const;
const FOREIGN_ENTRY_ID = IDS[3];
const FOREIGN_HOUSEHOLD_ID = IDS[5];
const HOME_HOUSEHOLD_ID = IDS[7];
const HOUSEHOLD_SCOPE =
  "(node:HomeRelayHousehold AND node.id = $householdId) OR node.householdId = $householdId";

let verifier: VerifierModule;

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "scripts", "verify-neo4j.mjs"),
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

function zeroResidual(): QueryResult {
  return {
    fields: ["nodeCount", "relationshipCount"],
    values: [[0, 0]],
  };
}

function successResults(): QueryResult[] {
  return [
    { fields: ["entryId", "itemId"], values: [[IDS[1], IDS[8]]] },
    { fields: ["entryId"], values: [[FOREIGN_ENTRY_ID]] },
    {
      fields: [
        "authorRole",
        "confirmerRole",
        "assigneeRole",
        "handoffStatus",
        "itemState",
      ],
      values: [["helper", "relative", "family", "done", "purchased"]],
    },
    { fields: ["foreignRelationCount"], values: [[0]] },
    { fields: [], values: [] },
    zeroResidual(),
    { fields: [], values: [] },
    zeroResidual(),
  ];
}

function sequentialExecutor(results: Array<QueryResult | Error>) {
  let index = 0;
  return vi.fn<Executor>(async () => {
    const result = results[index++];
    if (result instanceof Error) throw result;
    if (!result) throw new Error("unexpected executor call");
    return result;
  });
}

function callsContaining(
  executor: ReturnType<typeof sequentialExecutor>,
  pattern: string,
) {
  return executor.mock.calls.filter(([statement]) =>
    String(statement).includes(pattern),
  );
}

describe("Neo4j live verifier isolation and cleanup", () => {
  it("proves the home scope returns zero foreign relations", async () => {
    const executor = sequentialExecutor(successResults());
    const logger = safeLogger();

    await verifier.verifyNeo4jExecutor(executor, {
      logger,
      randomUuid: deterministicIds(),
    });

    const foreignProbe = executor.mock.calls[3];
    expect(foreignProbe?.[0]).toContain(
      "HomeRelayHousehold {id: $householdId}",
    );
    expect(foreignProbe?.[0]).toContain(
      "HomeRelayHandoff {id: $foreignEntryId}",
    );
    expect(foreignProbe?.[0]).toContain(
      "handoff.householdId = $householdId",
    );
    expect(foreignProbe?.[1]).toMatchObject({
      foreignEntryId: FOREIGN_ENTRY_ID,
      foreignHouseholdId: FOREIGN_HOUSEHOLD_ID,
      householdId: HOME_HOUSEHOLD_ID,
    });
    expect(logger.log).toHaveBeenCalledWith(
      "[verify-neo4j] PASS HomeRelay household filterで別世帯関係0件read-back",
    );
  });

  it("cleans both synthetic households once with scoped Cypher and zero read-back", async () => {
    const executor = sequentialExecutor(successResults());
    const logger = safeLogger();

    await expect(
      verifier.verifyNeo4jExecutor(executor, {
        logger,
        randomUuid: deterministicIds(),
      }),
    ).resolves.toBeUndefined();

    const cleanupCalls = callsContaining(executor, "DETACH DELETE");
    const readbackCalls = callsContaining(
      executor,
      "count(DISTINCT relationship) AS relationshipCount",
    );
    expect(cleanupCalls).toHaveLength(2);
    expect(readbackCalls).toHaveLength(2);
    expect(cleanupCalls.map(([, parameters]) => parameters)).toEqual([
      { householdId: HOME_HOUSEHOLD_ID },
      { householdId: FOREIGN_HOUSEHOLD_ID },
    ]);
    expect(readbackCalls.map(([, parameters]) => parameters)).toEqual([
      { householdId: HOME_HOUSEHOLD_ID },
      { householdId: FOREIGN_HOUSEHOLD_ID },
    ]);
    for (const [statement] of [...cleanupCalls, ...readbackCalls]) {
      expect(statement).toContain(HOUSEHOLD_SCOPE);
    }
    expect(logger.log).toHaveBeenCalledWith(
      "[verify-neo4j] PASS HomeRelay / 別世帯の合成graphを削除し両世帯node / relationship 0件read-back",
    );
  });

  it("attempts both scoped cleanups after an ambiguous first write failure", async () => {
    const ambiguousFailure = new Error("ambiguous transport failure");
    const executor = sequentialExecutor([
      ambiguousFailure,
      { fields: [], values: [] },
      zeroResidual(),
      { fields: [], values: [] },
      zeroResidual(),
    ]);

    await expect(
      verifier.verifyNeo4jExecutor(executor, {
        logger: safeLogger(),
        randomUuid: deterministicIds(),
      }),
    ).rejects.toBe(ambiguousFailure);

    expect(callsContaining(executor, "DETACH DELETE")).toHaveLength(2);
    expect(executor).toHaveBeenCalledTimes(5);
  });

  it("also cleans both households when the first write count is unexpected", async () => {
    const executor = sequentialExecutor([
      { fields: [], values: [] },
      { fields: [], values: [] },
      zeroResidual(),
      { fields: [], values: [] },
      zeroResidual(),
    ]);

    await expect(
      verifier.verifyNeo4jExecutor(executor, {
        logger: safeLogger(),
        randomUuid: deterministicIds(),
      }),
    ).rejects.toThrow("GRAPH_WRITE_NOT_OBSERVED");

    expect(callsContaining(executor, "DETACH DELETE")).toHaveLength(2);
    expect(executor).toHaveBeenCalledTimes(5);
  });

  it("fails the verification if a foreign relationship crosses the home scope", async () => {
    const results = successResults();
    results[3] = { fields: ["foreignRelationCount"], values: [[1]] };

    await expect(
      verifier.verifyNeo4jExecutor(sequentialExecutor(results), {
        logger: safeLogger(),
        randomUuid: deterministicIds(),
      }),
    ).rejects.toThrow("FOREIGN_HOUSEHOLD_SCOPE_FAILED");
  });

  it.each([
    { label: "residual node", nodeCount: 1, relationshipCount: 0 },
    { label: "residual relationship", nodeCount: 0, relationshipCount: 1 },
  ])("fails fatally on $label read-back", async ({ nodeCount, relationshipCount }) => {
    const results = successResults();
    results[5] = {
      fields: ["nodeCount", "relationshipCount"],
      values: [[nodeCount, relationshipCount]],
    };

    await expect(
      verifier.verifyNeo4jExecutor(sequentialExecutor(results), {
        logger: safeLogger(),
        randomUuid: deterministicIds(),
      }),
    ).rejects.toThrow("NEO4J_CLEANUP_FAILED");
  });

  it("continues both cleanups and makes a cleanup failure fatal", async () => {
    const executor = sequentialExecutor([
      new Error("ambiguous write"),
      new Error("home cleanup failed"),
      zeroResidual(),
      { fields: [], values: [] },
      zeroResidual(),
    ]);

    await expect(
      verifier.verifyNeo4jExecutor(executor, {
        logger: safeLogger(),
        randomUuid: deterministicIds(),
      }),
    ).rejects.toThrow("NEO4J_VERIFICATION_AND_CLEANUP_FAILED");

    expect(callsContaining(executor, "DETACH DELETE")).toHaveLength(2);
    expect(executor).toHaveBeenCalledTimes(5);
  });

  it("skips before fetch when E2E vendor isolation is enabled", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch must not run"));
    const logger = safeLogger();

    try {
      await expect(
        verifier.runNeo4jVerifier({
          environment: {
            HOMERELAY_DATA_MODE: "supabase",
            HOMERELAY_DEMO_MODE: "false",
            HOMERELAY_E2E_ISOLATE_VENDORS: "true",
            NEO4J_PASSWORD: "synthetic-password",
            NEO4J_URI: "neo4j+s://abcd1234.databases.neo4j.io",
            NEO4J_USERNAME: "abcd1234",
          },
          logger,
        }),
      ).resolves.toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining("SKIP / 未接続"),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
