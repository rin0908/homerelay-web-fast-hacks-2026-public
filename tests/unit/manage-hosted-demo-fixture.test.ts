import { describe, expect, it, vi } from "vitest";

// The production fixture manager intentionally remains a directly executable ESM script.
// @ts-expect-error The .mjs fixture manager does not publish TypeScript declarations.
import * as fixtureManager from "../../scripts/manage-hosted-demo-fixture.mjs";

const {
  CLEANUP_STAGE_NAMES,
  FIXTURE_ACCOUNTS,
  HOMERELAY_HOSTED_PROJECT,
  HOSTED_FIXTURE_ENV,
  cleanupAuth,
  cleanupDatabase,
  cleanupNeo4j,
  cleanupQdrant,
  cleanupStorage,
  createInitialFixtureLedger,
  executeCleanupPlan,
  executeProvisionPlan,
  inviteSyntheticAccount,
  loadHostedFixtureConfig,
  runHostedFixtureCommand,
  serializeFixtureLedger,
  validateFixtureLedger,
  validateFixtureStoragePaths,
} = fixtureManager;

function jwt(role: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.synthetic-signature`;
}

const PASSWORDS = Object.freeze({
  family: "FamilySyntheticPassword000000000000Aa1!",
  foreignFamily: "ForeignSyntheticPassword0000000000Aa1!",
  helper: "HelperSyntheticPassword000000000000Aa1!",
});

type FixtureAccountName = keyof typeof PASSWORDS;
type FixtureAccount = Readonly<{
  email: string;
  passwordEnvironmentName: string;
  role: string;
}>;
const TYPED_FIXTURE_ACCOUNTS = FIXTURE_ACCOUNTS as Record<
  FixtureAccountName,
  FixtureAccount
>;

const VALID_ENVIRONMENT = Object.freeze({
  HOMERELAY_CLOUD_FAMILY_PASSWORD: PASSWORDS.family,
  HOMERELAY_CLOUD_FOREIGN_FAMILY_PASSWORD: PASSWORDS.foreignFamily,
  HOMERELAY_CLOUD_HELPER_PASSWORD: PASSWORDS.helper,
  HOMERELAY_CLOUD_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
  HOMERELAY_CLOUD_SUPABASE_SECRET_KEY: jwt("service_role"),
  HOMERELAY_CLOUD_SUPABASE_URL: HOMERELAY_HOSTED_PROJECT.url,
  HOMERELAY_DATA_MODE: "supabase",
  HOMERELAY_DEMO_MODE: "false",
  HOMERELAY_HOSTED_FIXTURE_PROJECT: HOMERELAY_HOSTED_PROJECT.ref,
  HOMERELAY_HOSTED_NEO4J_DATABASE: "abcd1234",
  HOMERELAY_HOSTED_NEO4J_URI: "neo4j+s://abcd1234.databases.neo4j.io",
  HOMERELAY_HOSTED_QDRANT_COLLECTION: "homerelay_entries",
  HOMERELAY_HOSTED_QDRANT_URL: "https://synthetic.aws.cloud.qdrant.io",
  NEO4J_PASSWORD: "synthetic-neo4j-secret",
  NEO4J_URI: "neo4j+s://abcd1234.databases.neo4j.io",
  NEO4J_USERNAME: "abcd1234",
  QDRANT_API_KEY: "synthetic-qdrant-secret",
  QDRANT_URL: "https://synthetic.aws.cloud.qdrant.io",
});

const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
] as const;

function deterministicLedger() {
  let index = 0;
  return createInitialFixtureLedger({
    now: () => "2026-08-31T00:00:00.000Z",
    randomUuid: () => IDS[index++],
  });
}

function zeroSnapshot() {
  return {
    neo4j: { fixtureNodes: 0, fixtureRelationships: 0 },
    qdrant: { fixturePoints: 0 },
    supabase: {
      acknowledgements: 0,
      authUsers: 0,
      entries: 0,
      households: 0,
      members: 0,
      neededItems: 0,
      storageObjects: 0,
    },
  };
}

describe("hosted fixture configuration gate", () => {
  it("does not enable network work without the exact HomeRelay project opt-in", () => {
    expect(
      loadHostedFixtureConfig({
        ...VALID_ENVIRONMENT,
        [HOSTED_FIXTURE_ENV.enabledProject]: undefined,
      }),
    ).toEqual({
      missing: [HOSTED_FIXTURE_ENV.enabledProject],
      status: "skip",
    });
    expect(
      loadHostedFixtureConfig({
        ...VALID_ENVIRONMENT,
        [HOSTED_FIXTURE_ENV.enabledProject]: "different-project",
      }),
    ).toEqual({
      missing: [HOSTED_FIXTURE_ENV.enabledProject],
      status: "skip",
    });
  });

  it("accepts only the fixed hosted project and three distinct strong passwords", () => {
    expect(loadHostedFixtureConfig(VALID_ENVIRONMENT)).toMatchObject({ status: "ready" });
    expect(
      loadHostedFixtureConfig({
        ...VALID_ENVIRONMENT,
        HOMERELAY_CLOUD_SUPABASE_URL: "https://different.supabase.co",
      }),
    ).toEqual({ reason: "wrong_supabase_project", status: "invalid" });
    expect(
      loadHostedFixtureConfig({
        ...VALID_ENVIRONMENT,
        HOMERELAY_CLOUD_HELPER_PASSWORD: PASSWORDS.family,
      }),
    ).toEqual({ reason: "distinct_test_passwords_required", status: "invalid" });
  });

  it("rejects vendor isolation and a resource pin mismatch", () => {
    expect(
      loadHostedFixtureConfig({
        ...VALID_ENVIRONMENT,
        HOMERELAY_E2E_ISOLATE_VENDORS: "true",
      }),
    ).toEqual({ reason: "vendor_isolation_not_allowed", status: "invalid" });
    expect(() =>
      loadHostedFixtureConfig({
        ...VALID_ENVIRONMENT,
        HOMERELAY_HOSTED_QDRANT_URL: "https://other.aws.cloud.qdrant.io",
      }),
    ).toThrow("vendor_resource_pin_mismatch");
    expect(() =>
      loadHostedFixtureConfig({
        ...VALID_ENVIRONMENT,
        HOMERELAY_HOSTED_QDRANT_COLLECTION: "other_collection",
      }),
    ).toThrow("vendor_resource_pin_mismatch");
    expect(() =>
      loadHostedFixtureConfig({
        ...VALID_ENVIRONMENT,
        HOMERELAY_HOSTED_NEO4J_DATABASE: "other_database",
      }),
    ).toThrow("vendor_resource_pin_mismatch");
  });

  it("never returns configured values while reporting missing names", () => {
    const canary = "DoNotExposeSyntheticSecret000000000Aa1!";
    const result = loadHostedFixtureConfig({
      ...VALID_ENVIRONMENT,
      HOMERELAY_CLOUD_FAMILY_PASSWORD: canary,
      NEO4J_PASSWORD: undefined,
    });
    expect(result).toEqual({ missing: ["NEO4J_PASSWORD"], status: "skip" });
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  it("fails closed before creating a runtime when explicit execution lacks opt-in", async () => {
    const runtimeFactory = vi.fn();
    await expect(
      runHostedFixtureCommand("provision", {
        environment: {},
        logger: { log: vi.fn() },
        runtimeFactory,
      }),
    ).rejects.toThrow("fixture_configuration_missing");
    expect(runtimeFactory).not.toHaveBeenCalled();
  });
});

describe("secret-free fixture ledger", () => {
  it("stores only synthetic IDs and lifecycle metadata", () => {
    const ledger = deterministicLedger();
    const serialized = serializeFixtureLedger(ledger);
    for (const value of [
      ...Object.values(PASSWORDS),
      VALID_ENVIRONMENT.QDRANT_API_KEY,
      VALID_ENVIRONMENT.NEO4J_PASSWORD,
      VALID_ENVIRONMENT.HOMERELAY_CLOUD_SUPABASE_SECRET_KEY,
      ...Object.values(TYPED_FIXTURE_ACCOUNTS).map(({ email }) => email),
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).toContain(HOMERELAY_HOSTED_PROJECT.ref);
  });

  it("rejects secret-like fields even when their value looks synthetic", () => {
    const ledger = deterministicLedger();
    expect(() =>
      validateFixtureLedger({ ...ledger, password: "synthetic" }),
    ).toThrow("ledger_contains_forbidden_key");
  });

  it("accepts only an exact fixture household/member/object storage path", () => {
    const ledger = deterministicLedger();
    const fileName = "00000000-0000-4000-8000-000000000099.jpg";
    const valid = `${ledger.fixture.family.householdId}/${ledger.fixture.family.memberId}/${fileName}`;
    expect(validateFixtureStoragePaths([valid], ledger)).toEqual([valid]);
    expect(() =>
      validateFixtureStoragePaths(
        [
          `${ledger.fixture.foreignFamily.householdId}/${ledger.fixture.family.memberId}/${fileName}`,
        ],
        ledger,
      ),
    ).toThrow("fixture_storage_path_unsafe");
  });
});

describe("invite-only provisioning plan", () => {
  it("uses every invite callback before households and memberships", async () => {
    const ledger = deterministicLedger();
    const order: string[] = [];
    const saved: string[] = [];
    let userIndex = 10;

    await expect(
      executeProvisionPlan({
        accounts: Object.fromEntries(
          Object.entries(TYPED_FIXTURE_ACCOUNTS).map(([name, account]) => [
            name,
            { ...account, password: PASSWORDS[name as keyof typeof PASSWORDS] },
          ]),
        ),
        createHouseholds: async () => order.push("households"),
        createMembers: async () => order.push("members"),
        inviteAccount: async (name: string, account: { password: string }, remember: (id: string) => Promise<void>) => {
          order.push(`invite:${name}`);
          expect(account.password).toBe(PASSWORDS[name as keyof typeof PASSWORDS]);
          await remember(`00000000-0000-4000-8000-${String(userIndex++).padStart(12, "0")}`);
        },
        ledger,
        now: () => "2026-08-31T00:00:01.000Z",
        preflight: async () => order.push("preflight"),
        saveLedger: async (value: unknown) => saved.push(JSON.stringify(value)),
        verifyReady: async () => order.push("readback"),
      }),
    ).resolves.toMatchObject({ state: "ready" });

    expect(order).toEqual([
      "preflight",
      "invite:family",
      "invite:helper",
      "invite:foreignFamily",
      "households",
      "members",
      "readback",
    ]);
    expect(saved.length).toBeGreaterThanOrEqual(5);
    for (const serialized of saved) {
      for (const password of Object.values(PASSWORDS)) {
        expect(serialized).not.toContain(password);
      }
    }
  });

  it("globally revokes an invite session when password setup fails", async () => {
    const userId = "00000000-0000-4000-8000-000000000123";
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const disconnect = vi.fn();
    const remember = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      admin: {
        auth: {
          admin: {
            generateLink: vi.fn().mockResolvedValue({
              data: {
                properties: {
                  hashed_token: "synthetic-invite-token",
                  verification_type: "invite",
                },
                user: {
                  email: TYPED_FIXTURE_ACCOUNTS.family.email,
                  id: userId,
                },
              },
              error: null,
            }),
          },
        },
      },
      createPublic: vi.fn(() => ({
        auth: {
          signOut,
          updateUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { code: "synthetic_failure" },
          }),
          verifyOtp: vi.fn().mockResolvedValue({
            data: {
              session: { access_token: "synthetic-access-token" },
              user: { id: userId },
            },
            error: null,
          }),
        },
        realtime: { disconnect },
      })),
    };
    await expect(
      inviteSyntheticAccount(
        runtime,
        {
          ...TYPED_FIXTURE_ACCOUNTS.family,
          password: PASSWORDS.family,
        },
        remember,
      ),
    ).rejects.toThrow("invited_password_set_failed");
    expect(remember).toHaveBeenCalledWith(userId);
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("one-way hosted cleanup", () => {
  it("runs scoped stages in order and performs two independent zero read-backs", async () => {
    const ledger = deterministicLedger();
    ledger.state = "ready";
    const order: string[] = [];
    const stages = Object.fromEntries(
      CLEANUP_STAGE_NAMES.map((name: string) => [
        name,
        async () => order.push(name),
      ]),
    );

    await expect(
      executeCleanupPlan({
        ledger,
        readSnapshot: async () => {
          order.push("readback");
          return zeroSnapshot();
        },
        saveLedger: async () => {},
        settle: async () => order.push("settle"),
        stages,
      }),
    ).resolves.toMatchObject({ first: zeroSnapshot(), second: zeroSnapshot() });
    expect(order).toEqual([
      "qdrant",
      "neo4j",
      "storage",
      "database",
      "auth",
      "readback",
      "settle",
      "readback",
    ]);
    expect(ledger.state).toBe("cleaned");
  });

  it("stops on the first failed stage, retains a failed ledger, and refuses retry", async () => {
    const ledger = deterministicLedger();
    ledger.state = "ready";
    const savedStates: string[] = [];
    const neo4j = vi.fn(async () => {
      throw new Error("vendor detail must remain private");
    });
    const laterStage = vi.fn(async () => {});
    const stages = {
      auth: laterStage,
      database: laterStage,
      neo4j,
      qdrant: vi.fn(async () => {}),
      storage: laterStage,
    };

    await expect(
      executeCleanupPlan({
        ledger,
        readSnapshot: async () => zeroSnapshot(),
        saveLedger: async (value: { state: string }) => savedStates.push(value.state),
        settle: async () => {},
        stages,
      }),
    ).rejects.toThrow("neo4j_cleanup_failed");
    expect(neo4j).toHaveBeenCalledOnce();
    expect(laterStage).not.toHaveBeenCalled();
    expect(savedStates.at(-1)).toBe("cleanup_failed");

    await expect(
      executeCleanupPlan({
        ledger,
        readSnapshot: async () => zeroSnapshot(),
        saveLedger: async () => {},
        settle: async () => {},
        stages,
      }),
    ).rejects.toThrow("cleanup_retry_refused");
    expect(neo4j).toHaveBeenCalledOnce();
  });

  it("keeps the ledger when either independent read-back is not zero", async () => {
    const ledger = deterministicLedger();
    ledger.state = "ready";
    const snapshots = [zeroSnapshot(), zeroSnapshot()];
    snapshots[1].qdrant.fixturePoints = 1;
    const savedStates: string[] = [];
    let index = 0;

    await expect(
      executeCleanupPlan({
        ledger,
        readSnapshot: async () => snapshots[index++],
        saveLedger: async (value: { state: string }) => savedStates.push(value.state),
        settle: async () => {},
        stages: Object.fromEntries(
          CLEANUP_STAGE_NAMES.map((name: string) => [name, async () => {}]),
        ),
      }),
    ).rejects.toThrow("second_cleanup_readback_not_zero");
    expect(savedStates.at(-1)).toBe("cleanup_failed");
  });
});

describe("scoped hosted cleanup stages", () => {
  it("deletes Qdrant points only through both exact fixture household filters", async () => {
    const ledger = deterministicLedger();
    const deletePoints = vi.fn().mockResolvedValue({});
    const scroll = vi.fn().mockResolvedValue({ points: [] });
    await cleanupQdrant(
      { qdrant: { delete: deletePoints, scroll } },
      { collection: "homerelay_entries", timeoutMs: 4_000 },
      ledger,
    );
    const expectedHouseholds = [
      ledger.fixture.family.householdId,
      ledger.fixture.foreignFamily.householdId,
    ];
    expect(deletePoints).toHaveBeenCalledTimes(2);
    expect(
      deletePoints.mock.calls.map(([, request]) => request.filter.must[0].match.value),
    ).toEqual(expectedHouseholds);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("uses parameterized Neo4j fixture household IDs and reads zero back", async () => {
    const ledger = deterministicLedger();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { fields: [], values: [] }, errors: [] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              fields: ["nodeCount", "relationshipCount"],
              values: [[0, 0]],
            },
            errors: [],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await cleanupNeo4j(
        {
          authorization: "synthetic-basic-authorization",
          endpoint: "https://synthetic.databases.neo4j.io/db/neo4j/query/v2",
          timeoutMs: 1_000,
        },
        ledger,
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(request.statement).toContain("HomeRelayHousehold");
    expect(request.statement).toContain("DETACH DELETE n");
    expect(request.parameters.householdIds).toEqual([
      ledger.fixture.family.householdId,
      ledger.fixture.foreignFamily.householdId,
    ]);
  });

  it("validates every Storage path before the first service-key remove", async () => {
    const ledger = deterministicLedger();
    const unsafePath = `${ledger.fixture.foreignFamily.householdId}/${ledger.fixture.family.memberId}/00000000-0000-4000-8000-000000000099.jpg`;
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    const admin = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({
            data: table === "entries" ? [{ photo_path: unsafePath }] : [],
            error: null,
          }),
        })),
      })),
      storage: { from: vi.fn(() => ({ list, remove })) },
    };
    await expect(cleanupStorage(admin, ledger)).rejects.toThrow(
      "fixture_storage_path_unsafe",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes database children before exact fixture households", async () => {
    const ledger = deterministicLedger();
    const calls: Array<{ column: string; ids: string[]; table: string }> = [];
    const admin = {
      from: vi.fn((table: string) => ({
        delete: vi.fn(() => ({
          in: vi.fn((column: string, ids: string[]) => ({
            select: vi.fn(async () => {
              calls.push({ column, ids, table });
              return { data: [], error: null };
            }),
          })),
        })),
      })),
    };
    await cleanupDatabase(admin, ledger);
    expect(calls.map(({ table }) => table)).toEqual([
      "acknowledgements",
      "needed_items",
      "entries",
      "members",
      "households",
    ]);
    expect(calls.at(-1)?.column).toBe("id");
    expect(calls.every(({ ids }) => ids.length === 2)).toBe(true);
  });

  it("globally revokes only fixture accounts before deleting exact Auth users", async () => {
    const ledger = deterministicLedger();
    const accountEntries = Object.entries(TYPED_FIXTURE_ACCOUNTS) as Array<
      [FixtureAccountName, FixtureAccount]
    >;
    accountEntries.forEach(([name], index) => {
      ledger.fixture[name].authUserId = `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`;
    });
    const signOuts: ReturnType<typeof vi.fn>[] = [];
    const disconnects: ReturnType<typeof vi.fn>[] = [];
    let index = 0;
    const accounts = Object.fromEntries(
      accountEntries.map(([name, account]) => [
        name,
        { ...account, password: PASSWORDS[name as keyof typeof PASSWORDS] },
      ]),
    );
    const createPublic = vi.fn(() => {
      const fixture = ledger.fixture[accountEntries[index][0]];
      index += 1;
      const signOut = vi.fn().mockResolvedValue({ error: null });
      const disconnect = vi.fn();
      signOuts.push(signOut);
      disconnects.push(disconnect);
      return {
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: {
              session: { access_token: "synthetic-access-token" },
              user: { id: fixture.authUserId },
            },
            error: null,
          }),
          signOut,
        },
        realtime: { disconnect },
      };
    });
    const deleteUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const fixtureUsers = accountEntries.map(([name, account]) => ({
      email: account.email,
      id: ledger.fixture[name].authUserId,
    }));
    const unrelatedId = "00000000-0000-4000-8000-000000009999";
    const runtime = {
      admin: {
        auth: {
          admin: {
            deleteUser,
            listUsers: vi.fn().mockResolvedValue({
              data: { users: [...fixtureUsers, { email: "other@example.test", id: unrelatedId }] },
              error: null,
            }),
          },
        },
      },
      createPublic,
    };
    await executeCleanupPlan({
      ledger,
      readSnapshot: async () => zeroSnapshot(),
      saveLedger: async () => {},
      settle: async () => {},
      stages: {
        auth: (value: unknown, context: { startedFromState: string }) =>
          cleanupAuth(runtime, accounts, value, {
            allowMissingPassword:
              context.startedFromState !== "ready",
          }),
        database: async () => {},
        neo4j: async () => {},
        qdrant: async () => {},
        storage: async () => {},
      },
    });
    expect(signOuts.every((signOut) => signOut.mock.calls[0][0].scope === "global")).toBe(
      true,
    );
    expect(disconnects.every((disconnect) => disconnect.mock.calls.length === 1)).toBe(
      true,
    );
    expect(deleteUser.mock.calls.map(([id]) => id)).toEqual(
      fixtureUsers.map(({ id }) => id),
    );
    expect(deleteUser).not.toHaveBeenCalledWith(unrelatedId);
  });

  it("cleans only users that exist after a partial invite failure", async () => {
    const ledger = deterministicLedger();
    const familyId = "00000000-0000-4000-8000-000000000111";
    ledger.state = "provision_failed";
    ledger.fixture.family.authUserId = familyId;
    const accountEntries = Object.entries(TYPED_FIXTURE_ACCOUNTS) as Array<
      [FixtureAccountName, FixtureAccount]
    >;
    const accounts = Object.fromEntries(
      accountEntries.map(([name, account]) => [
        name,
        { ...account, password: PASSWORDS[name] },
      ]),
    );
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const disconnect = vi.fn();
    const deleteUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const runtime = {
      admin: {
        auth: {
          admin: {
            deleteUser,
            listUsers: vi.fn().mockResolvedValue({
              data: {
                users: [
                  {
                    email: TYPED_FIXTURE_ACCOUNTS.family.email,
                    id: familyId,
                  },
                ],
              },
              error: null,
            }),
          },
        },
      },
      createPublic: vi.fn(() => ({
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { session: null, user: null },
            error: { code: "invalid_credentials" },
          }),
          signOut,
        },
        realtime: { disconnect },
      })),
    };

    await executeCleanupPlan({
      ledger,
      readSnapshot: async () => zeroSnapshot(),
      saveLedger: async () => {},
      settle: async () => {},
      stages: {
        auth: (value: unknown, context: { startedFromState: string }) =>
          cleanupAuth(runtime, accounts, value, {
            allowMissingPassword:
              context.startedFromState !== "ready",
          }),
        database: async () => {},
        neo4j: async () => {},
        qdrant: async () => {},
        storage: async () => {},
      },
    });
    expect(runtime.createPublic).toHaveBeenCalledOnce();
    expect(signOut).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledOnce();
    expect(deleteUser).toHaveBeenCalledWith(familyId);
  });
});
