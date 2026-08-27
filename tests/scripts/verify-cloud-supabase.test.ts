import { describe, expect, it, vi } from "vitest";

// The production verifier intentionally remains a directly executable ESM script.
// @ts-expect-error The .mjs verifier does not publish TypeScript declarations.
import * as cloudVerifier from "../../scripts/verify-cloud-supabase.mjs";

const {
  CLOUD_SUPABASE_ENV,
  isLoopbackHostname,
  isPublishableKey,
  loadCloudSupabaseConfig,
  runCloudSupabaseVerification,
} = cloudVerifier;

const VALID_ENVIRONMENT = Object.freeze({
  [CLOUD_SUPABASE_ENV.enabled]: "true",
  [CLOUD_SUPABASE_ENV.familyEmail]: "family@synthetic.example",
  [CLOUD_SUPABASE_ENV.familyPassword]: "synthetic-family-password",
  [CLOUD_SUPABASE_ENV.foreignFamilyEmail]: "foreign@synthetic.example",
  [CLOUD_SUPABASE_ENV.foreignFamilyPassword]: "synthetic-foreign-password",
  [CLOUD_SUPABASE_ENV.helperEmail]: "helper@synthetic.example",
  [CLOUD_SUPABASE_ENV.helperPassword]: "synthetic-helper-password",
  [CLOUD_SUPABASE_ENV.publishableKey]: `sb_publishable_${"a".repeat(32)}`,
  [CLOUD_SUPABASE_ENV.url]: "https://synthetic-project.supabase.co",
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

  it("normalizes a valid hosted HTTPS origin", () => {
    expect(
      loadCloudSupabaseConfig({
        ...VALID_ENVIRONMENT,
        [CLOUD_SUPABASE_ENV.url]: " HTTPS://Synthetic.Example/ ",
      }),
    ).toMatchObject({
      config: { url: "https://synthetic.example" },
      status: "ready",
    });
  });

  it("recognizes loopback host variants", () => {
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("worker.localhost")).toBe(true);
    expect(isLoopbackHostname("127.99.10.4")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("synthetic.example")).toBe(false);
  });

  it("accepts publishable/legacy anon keys and refuses secret/service-role keys", () => {
    expect(isPublishableKey(`sb_publishable_${"a".repeat(32)}`)).toBe(true);
    expect(isPublishableKey(jwt("anon"))).toBe(true);
    expect(isPublishableKey(`sb_secret_${"a".repeat(32)}`)).toBe(false);
    expect(isPublishableKey(jwt("service_role"))).toBe(false);
    expect(isPublishableKey("not-a-publishable-key")).toBe(false);
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

  it("does not define or accept a service-role environment variable", () => {
    expect(Object.values(CLOUD_SUPABASE_ENV)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/service|secret/i)]),
    );
  });
});
