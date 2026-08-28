import { describe, expect, it, vi } from "vitest";

// The production verifier intentionally remains a directly executable ESM script.
// @ts-expect-error The .mjs verifier does not publish TypeScript declarations.
import * as cloudVerifier from "../../scripts/verify-cloud-supabase.mjs";

const {
  CLOUD_SUPABASE_ENV,
  HOMERELAY_CLOUD_PROJECT,
  bounded,
  classifySupabaseError,
  executeStrictCleanup,
  isLoopbackHostname,
  isPublishableKey,
  isSecretKey,
  loadCloudSupabaseConfig,
  reportVerificationFailure,
  requireAdminInviteLink,
  requireAuthenticatedHouseholdDenial,
  requireAuthorizationDenial,
  requireKnownExistingStorageReadDenial,
  requireSdkSuccess,
  runRecoverableDenialProbe,
  runCloudSupabaseVerification,
} = cloudVerifier;

const VALID_ENVIRONMENT = Object.freeze({
  [CLOUD_SUPABASE_ENV.enabled]: "true",
  [CLOUD_SUPABASE_ENV.familyEmail]: "family-a@homerelay.test",
  [CLOUD_SUPABASE_ENV.familyPassword]: "synthetic-family-password",
  [CLOUD_SUPABASE_ENV.foreignFamilyEmail]: "family-b@homerelay.test",
  [CLOUD_SUPABASE_ENV.foreignFamilyPassword]: "synthetic-foreign-password",
  [CLOUD_SUPABASE_ENV.helperEmail]: "helper-a@homerelay.test",
  [CLOUD_SUPABASE_ENV.helperPassword]: "synthetic-helper-password",
  [CLOUD_SUPABASE_ENV.publishableKey]: `sb_publishable_${"a".repeat(32)}`,
  [CLOUD_SUPABASE_ENV.secretKey]: `sb_secret_${"b".repeat(32)}`,
  [CLOUD_SUPABASE_ENV.url]: HOMERELAY_CLOUD_PROJECT.url,
});

function jwt(role: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.synthetic-signature`;
}

describe("cloud Supabase verifier configuration", () => {
  it("SKIPs without the explicit cloud opt-in and never starts a connection", async () => {
    expect(loadCloudSupabaseConfig(VALID_ENVIRONMENT)).toMatchObject({
      status: "ready",
    });
    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [CLOUD_SUPABASE_ENV.enabled]: undefined,
      }),
    ).toEqual({
      missing: [CLOUD_SUPABASE_ENV.enabled],
      status: "skip",
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(runCloudSupabaseVerification({})).resolves.toEqual({
      status: "skipped",
    });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain("SKIP / non-connected");
    log.mockRestore();
  });

  it("lists only missing environment variable names, never configured values", () => {
    const uniqueSecret = "do-not-print-this-synthetic-password";
    const loaded = loadCloudSupabaseConfig({
      ...VALID_ENVIRONMENT,
      [CLOUD_SUPABASE_ENV.familyPassword]: uniqueSecret,
      [CLOUD_SUPABASE_ENV.helperPassword]: undefined,
    });

    expect(loaded).toEqual({
      missing: [CLOUD_SUPABASE_ENV.helperPassword],
      status: "skip",
    });
    expect(JSON.stringify(loaded)).not.toContain(uniqueSecret);
  });

  it.each([
    "http://synthetic-project.supabase.co",
    "https://localhost",
    "https://api.localhost",
    "https://127.0.0.2",
    "https://[::1]",
    "https://synthetic-project.supabase.co/rest/v1",
    "https://user:password@synthetic-project.supabase.co",
  ])("refuses non-hosted or non-HTTPS URL %s", (url) => {
    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [CLOUD_SUPABASE_ENV.url]: url,
      }),
    ).toEqual({ reason: "unsafe_cloud_url", status: "invalid" });
  });

  it("normalizes and accepts only the dedicated HomeRelay project origin", () => {
    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [CLOUD_SUPABASE_ENV.url]: " HTTPS://CZFMQAEQAMEPNTPSAKBV.SUPABASE.CO/ ",
      }),
    ).toMatchObject({
      config: { url: HOMERELAY_CLOUD_PROJECT.url },
      status: "ready",
    });

    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [CLOUD_SUPABASE_ENV.url]: "https://different-project.supabase.co",
      }),
    ).toEqual({ reason: "wrong_cloud_project", status: "invalid" });
  });

  it("recognizes loopback host variants", () => {
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("worker.localhost")).toBe(true);
    expect(isLoopbackHostname("127.99.10.4")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("synthetic.example")).toBe(false);
  });

  it("separates publishable and server-only secret key formats", () => {
    expect(isPublishableKey(`sb_publishable_${"a".repeat(32)}`)).toBe(true);
    expect(isPublishableKey(jwt("anon"))).toBe(true);
    expect(isPublishableKey(`sb_secret_${"a".repeat(32)}`)).toBe(false);
    expect(isPublishableKey(jwt("service_role"))).toBe(false);
    expect(isPublishableKey("not-a-publishable-key")).toBe(false);

    expect(isSecretKey(`sb_secret_${"a".repeat(32)}`)).toBe(true);
    expect(isSecretKey(jwt("service_role"))).toBe(true);
    expect(isSecretKey(`sb_publishable_${"a".repeat(32)}`)).toBe(false);
    expect(isSecretKey(jwt("anon"))).toBe(false);
  });

  it("requires three distinct invited account emails", () => {
    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [CLOUD_SUPABASE_ENV.foreignFamilyEmail]:
          VALID_ENVIRONMENT[CLOUD_SUPABASE_ENV.familyEmail].toUpperCase(),
      }),
    ).toEqual({ reason: "accounts_must_be_distinct", status: "invalid" });
  });

  it.each([
    CLOUD_SUPABASE_ENV.familyEmail,
    CLOUD_SUPABASE_ENV.helperEmail,
    CLOUD_SUPABASE_ENV.foreignFamilyEmail,
  ])("requires reserved synthetic HomeRelay test account for %s", (field) => {
    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [field]: "real-person@example.com",
      }),
    ).toEqual({ reason: "invalid_account_email", status: "invalid" });
  });

  it("requires a server-only cleanup key and never treats it as publishable", () => {
    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [CLOUD_SUPABASE_ENV.secretKey]: undefined,
      }),
    ).toEqual({ missing: [CLOUD_SUPABASE_ENV.secretKey], status: "skip" });
    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [CLOUD_SUPABASE_ENV.secretKey]: `sb_publishable_${"c".repeat(32)}`,
      }),
    ).toEqual({ reason: "server_secret_key_required", status: "invalid" });
  });
});

describe("cloud Supabase verifier failure classification and recovery", () => {
  const success = (data: unknown = []) => ({ data, error: null });
  const denied = (error: Record<string, unknown>) => ({ data: null, error });

  it("accepts only a complete admin invite-link result for the expected .test user", () => {
    const email = "invited-user@homerelay.test";
    const result = {
      data: {
        properties: {
          action_link: "https://synthetic.invalid/auth/v1/verify",
          hashed_token: "synthetic-hashed-token",
          verification_type: "invite",
        },
        user: { email, id: "00000000-0000-4000-8000-000000000001" },
      },
      error: null,
    };

    expect(requireAdminInviteLink(result, email)).toEqual(result.data.user);
    expect(() =>
      requireAdminInviteLink(
        {
          ...result,
          data: {
            ...result.data,
            properties: { ...result.data.properties, verification_type: "signup" },
          },
        },
        email,
      ),
    ).toThrow("admin_invite_check_failed");
  });

  it("aborts an abortable operation at timeout and returns only a fixed code", async () => {
    const canary = "do-not-return-this-transport-detail";
    let abortObserved = false;
    const operation = {
      abortSignal(signal: AbortSignal) {
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              abortObserved = signal.aborted;
              reject(new Error(canary));
            },
            { once: true },
          );
        });
      },
    };

    let reported = "";
    try {
      await bounded(operation, "synthetic_operation_timeout", 5);
    } catch (error) {
      const logger = vi.fn();
      reportVerificationFailure(error, logger);
      reported = String(logger.mock.calls[0][0]);
    }
    expect(abortObserved).toBe(true);
    expect(reported).toContain("synthetic_operation_timeout");
    expect(reported).not.toContain(canary);
  });

  it.each([
    { status: 401 },
    { statusCode: "403" },
    { status: 400, statusCode: "403" },
    { code: "42501" },
  ])("accepts only a structured authorization denial %#", (error) => {
    expect(() =>
      requireAuthorizationDenial(denied(error), "synthetic_denial_failed"),
    ).not.toThrow();
    expect(classifySupabaseError(error)).toBe("authorization_denied");
  });

  it("requires an authenticated SQL/RLS denial for guarded household RPCs", () => {
    expect(() =>
      requireAuthenticatedHouseholdDenial(
        denied({ status: 403 }),
        "strict_household_denial_failed",
      ),
    ).not.toThrow();
    expect(() =>
      requireAuthenticatedHouseholdDenial(
        denied({ code: "42501", status: 400 }),
        "strict_household_denial_failed",
      ),
    ).not.toThrow();
    expect(() =>
      requireAuthenticatedHouseholdDenial(
        denied({ status: 401 }),
        "strict_household_denial_failed",
      ),
    ).toThrow("strict_household_denial_failed_authorization_denied");
    expect(() =>
      requireAuthenticatedHouseholdDenial(
        success(true),
        "strict_household_denial_failed",
      ),
    ).toThrow("strict_household_denial_failed");

    for (const [error, kind] of [
      [{ code: "42501", status: 429 }, "rate_limited"],
      [{ status: 503, statusCode: "403" }, "server_error"],
      [{ code: "42501", name: "TimeoutError" }, "timeout"],
      [{ name: "TypeError", status: 403 }, "network_error"],
    ] as const) {
      expect(() =>
        requireAuthenticatedHouseholdDenial(
          denied(error),
          "strict_household_denial_failed",
        ),
      ).toThrow(`strict_household_denial_failed_${kind}`);
    }
  });

  it.each([
    [{ status: 429 }, "rate_limited"],
    [{ statusCode: 500 }, "server_error"],
    [{ status: 503 }, "server_error"],
    [{ name: "TypeError" }, "network_error"],
    [{ name: "TimeoutError" }, "timeout"],
  ])("does not misclassify infrastructure failure %# as authorization", (error, kind) => {
    expect(classifySupabaseError(error)).toBe(kind);
    expect(() =>
      requireAuthorizationDenial(denied(error), "synthetic_denial_failed"),
    ).toThrow(`synthetic_denial_failed_${kind}`);
  });

  it.each([
    [{ code: "42501", status: 429 }, "rate_limited"],
    [{ status: 503, statusCode: "403" }, "server_error"],
    [{ code: "42501", name: "TimeoutError" }, "timeout"],
    [{ name: "TypeError", status: 403 }, "network_error"],
  ])(
    "gives infrastructure failure precedence over a concurrent denial marker %#",
    (error, kind) => {
      expect(classifySupabaseError(error)).toBe(kind);
      expect(() =>
        requireAuthorizationDenial(denied(error), "synthetic_denial_failed"),
      ).toThrow(`synthetic_denial_failed_${kind}`);
    },
  );

  it("accepts Storage non-disclosure only after the caller proved the object exists", () => {
    expect(() =>
      requireKnownExistingStorageReadDenial(
        denied({
          name: "StorageApiError",
          status: 400,
          statusCode: "NoSuchKey",
        }),
        "foreign_photo_visible",
      ),
    ).not.toThrow();
    expect(() =>
      requireKnownExistingStorageReadDenial(
        denied({ name: "StorageApiError", status: 500, statusCode: "InternalError" }),
        "foreign_photo_visible",
      ),
    ).toThrow("foreign_photo_visible_server_error");
  });

  it("fails a Storage create response whenever the SDK returns an error", () => {
    expect(() =>
      requireSdkSuccess(
        { data: null, error: { statusCode: 500 } },
        "storage_create_failed",
      ),
    ).toThrow("storage_create_failed");
  });

  it("fails when Storage cleanup returns an SDK error", async () => {
    const verifyRecovered = vi.fn(async () => true);
    await expect(
      runRecoverableDenialProbe({
        attempt: async () => denied({ status: 403 }),
        cleanup: async () => ({ data: null, error: { status: 500 } }),
        cleanupCode: "storage_cleanup_failed",
        denialCode: "foreign_storage_insert_not_denied",
        settle: async () => {},
        verifyRecovered,
      }),
    ).rejects.toThrow("storage_cleanup_failed");
    expect(verifyRecovered).not.toHaveBeenCalled();
  });

  it("fails when Data API cleanup returns an SDK error", async () => {
    await expect(
      runRecoverableDenialProbe({
        attempt: async () => denied({ code: "42501" }),
        cleanup: async () => ({ data: null, error: { status: 503 } }),
        cleanupCode: "data_cleanup_failed",
        denialCode: "foreign_direct_insert_not_denied",
        settle: async () => {},
        verifyRecovered: async () => true,
      }),
    ).rejects.toThrow("data_cleanup_failed");
  });

  it("still removes Auth users after a Storage failure when Data cleanup succeeded", async () => {
    const cleanupAuth = vi.fn(async () => {});
    const cleanupData = vi.fn(async () => {});
    const verifyEmpty = vi.fn(async () => {
      requireSdkSuccess(
        { data: null, error: { status: 500 } },
        "post_cleanup_auth_users_not_zero",
      );
    });
    await expect(
      executeStrictCleanup({
        cleanupAuth,
        cleanupData,
        cleanupStorage: async () => {
          requireSdkSuccess(
            { data: null, error: { status: 500 } },
            "storage_cleanup_failed",
          );
        },
        settle: async () => {},
        verifyEmpty,
      }),
    ).rejects.toThrow("storage_cleanup_failed");
    expect(cleanupData).toHaveBeenCalledOnce();
    expect(cleanupAuth).toHaveBeenCalledOnce();
    expect(verifyEmpty).toHaveBeenCalledTimes(2);
  });

  it("blocks Auth deletion after a Data API cleanup failure", async () => {
    const cleanupAuth = vi.fn(async () => {});
    await expect(
      executeStrictCleanup({
        cleanupAuth,
        cleanupData: async () => {
          requireSdkSuccess(
            { data: null, error: { status: 500 } },
            "data_cleanup_failed",
          );
        },
        cleanupStorage: async () => {},
        settle: async () => {},
        verifyEmpty: async () => {
          requireSdkSuccess(
            { data: null, error: { status: 500 } },
            "post_cleanup_rows_not_zero",
          );
        },
      }),
    ).rejects.toThrow("data_cleanup_failed");
    expect(cleanupAuth).not.toHaveBeenCalled();
  });

  it("fails when final residual verification is not empty", async () => {
    const cleanupAuth = vi.fn(async () => {});
    await expect(
      executeStrictCleanup({
        cleanupAuth,
        cleanupData: async () => {},
        cleanupStorage: async () => {},
        settle: async () => {},
        verifyEmpty: async () => {
          requireSdkSuccess(
            { data: null, error: { status: 500 } },
            "post_cleanup_storage_objects_not_zero",
          );
        },
      }),
    ).rejects.toThrow("post_cleanup_storage_objects_not_zero");
    expect(cleanupAuth).toHaveBeenCalledOnce();
  });

  it("recovers an unexpectedly successful foreign INSERT but still fails security", async () => {
    const cleanup = vi.fn(async () => success([]));
    const verifyRecovered = vi.fn(async () => true);
    await expect(
      runRecoverableDenialProbe({
        attempt: async () => success([{ id: "synthetic-id" }]),
        cleanup,
        cleanupCode: "foreign_insert_cleanup_failed",
        denialCode: "foreign_insert_not_denied",
        settle: async () => {},
        verifyRecovered,
      }),
    ).rejects.toThrow("foreign_insert_not_denied");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(verifyRecovered).toHaveBeenCalledTimes(2);
  });

  it("preserves both the security failure and a recovery failure", async () => {
    await expect(
      runRecoverableDenialProbe({
        attempt: async () => success([{ id: "synthetic-id" }]),
        cleanup: async () => ({ data: null, error: { status: 500 } }),
        cleanupCode: "foreign_insert_cleanup_failed",
        denialCode: "foreign_insert_not_denied",
        settle: async () => {},
        verifyRecovered: async () => true,
      }),
    ).rejects.toThrow(
      "foreign_insert_not_denied__and__foreign_insert_cleanup_failed",
    );
  });

  it("fails after cleanup when a verification artifact remains", async () => {
    await expect(
      runRecoverableDenialProbe({
        attempt: async () => denied({ status: 403 }),
        cleanup: async () => success([]),
        cleanupCode: "storage_cleanup_failed",
        denialCode: "foreign_storage_insert_not_denied",
        settle: async () => {},
        verifyRecovered: async () => false,
      }),
    ).rejects.toThrow("storage_cleanup_failed_residual");
  });

  it("fails when an artifact appears after the recovery settle window", async () => {
    const verifyRecovered = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(
      runRecoverableDenialProbe({
        attempt: async () => denied({ status: 403 }),
        cleanup: async () => success([]),
        cleanupCode: "data_cleanup_failed",
        denialCode: "foreign_insert_not_denied",
        settle: async () => {},
        verifyRecovered,
      }),
    ).rejects.toThrow("data_cleanup_failed_late_residual");
    expect(verifyRecovered).toHaveBeenCalledTimes(2);
  });

  it("runs recovery before failing on 429, 5xx, and thrown network errors", async () => {
    const attempts = [
      async () => denied({ status: 429 }),
      async () => denied({ status: 502 }),
      async () => denied({ name: "TimeoutError" }),
      async () => {
        throw new TypeError("synthetic transport failure");
      },
    ];

    for (const attempt of attempts) {
      const cleanup = vi.fn(async () => success([]));
      await expect(
        runRecoverableDenialProbe({
          attempt,
          cleanup,
          cleanupCode: "probe_cleanup_failed",
          denialCode: "probe_not_denied",
          settle: async () => {},
          verifyRecovered: async () => true,
        }),
      ).rejects.toThrow();
      expect(cleanup).toHaveBeenCalledOnce();
    }
  });

  it("runs strict cleanup in a deterministic order and verifies twice", async () => {
    const order: string[] = [];
    await expect(
      executeStrictCleanup({
        cleanupAuth: async () => order.push("auth"),
        cleanupData: async () => order.push("data"),
        cleanupStorage: async () => order.push("storage"),
        settle: async () => order.push("settle"),
        verifyEmpty: async () => order.push("verify"),
      }),
    ).resolves.toBeUndefined();
    expect(order).toEqual([
      "storage",
      "data",
      "auth",
      "verify",
      "settle",
      "verify",
    ]);
  });

  it("never writes an unexpected secret-bearing error to logs", () => {
    const canaries = [
      "do-not-log-this-secret-value",
      VALID_ENVIRONMENT[CLOUD_SUPABASE_ENV.secretKey],
      VALID_ENVIRONMENT[CLOUD_SUPABASE_ENV.familyPassword],
    ];
    const logger = vi.fn();
    reportVerificationFailure(new Error(canaries.join("::")), logger);
    const output = JSON.stringify(logger.mock.calls);
    expect(output).toContain("unexpected_verification_failure");
    for (const canary of canaries) expect(output).not.toContain(canary);
    expect("SafeVerificationError" in cloudVerifier).toBe(false);
  });
});
