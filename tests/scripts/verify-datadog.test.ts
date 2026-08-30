import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

type VerifierModule = Readonly<{
  DATADOG_VERIFICATION_MARKER_TAG: string;
  runDatadogVerifier: (options?: Record<string, unknown>) => Promise<number>;
  safeDatadogConfiguration: (
    environment?: Record<string, string | undefined>,
  ) => unknown;
  syntheticVerificationSeries: (nowMs?: number) => Array<{
    metric: string;
    points: Array<{ timestamp: number; value: number }>;
    tags: string[];
    type: number;
  }>;
  verifyDatadog: (options?: Record<string, unknown>) => Promise<{
    status: "accepted" | "skipped";
  }>;
}>;

const API_KEY = "a".repeat(32);
const NOW = Date.parse("2026-08-30T03:00:00.000Z");

let verifier: VerifierModule;

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "scripts", "verify-datadog.mjs"),
  ).href;
  verifier = (await import(/* @vite-ignore */ moduleUrl)) as VerifierModule;
});

function liveEnvironment(overrides: Record<string, string> = {}) {
  return {
    DD_API_KEY: API_KEY,
    DD_SITE: "ap1.datadoghq.com",
    HOMERELAY_DATA_MODE: "supabase",
    HOMERELAY_DEMO_MODE: "false",
    ...overrides,
  };
}

function safeLogger() {
  return { error: vi.fn(), log: vi.fn() };
}

describe("Datadog live verifier", () => {
  it("skips without credentials or outside explicit live mode before fetching", async () => {
    for (const environment of [
      { HOMERELAY_DATA_MODE: "supabase" },
      liveEnvironment({ HOMERELAY_DATA_MODE: "demo" }),
      liveEnvironment({ HOMERELAY_DEMO_MODE: "true" }),
      liveEnvironment({ HOMERELAY_E2E_ISOLATE_VENDORS: "true" }),
    ]) {
      const fetchImpl = vi.fn();
      await expect(
        verifier.verifyDatadog({ environment, fetchImpl }),
      ).resolves.toEqual({ status: "skipped" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("submits fixed synthetic success/failure counters and duration with one safe UI marker", async () => {
    const bodyReader = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      json: bodyReader,
      status: 202,
      text: bodyReader,
    });
    const signal = new AbortController().signal;
    const abortSignalFactory = vi.fn(() => signal);

    await expect(
      verifier.verifyDatadog({
        abortSignalFactory,
        environment: liveEnvironment({ DATADOG_TIMEOUT_MS: "2500" }),
        fetchImpl,
        now: () => NOW,
      }),
    ).resolves.toEqual({ status: "accepted" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("https://api.ap1.datadoghq.com/api/v2/series");
    expect(init).toMatchObject({
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "DD-API-KEY": API_KEY,
      },
      method: "POST",
      redirect: "error",
      signal,
    });
    expect(abortSignalFactory).toHaveBeenCalledWith(2_500);
    expect(bodyReader).not.toHaveBeenCalled();

    const payload = JSON.parse(init.body as string) as {
      series: Array<{
        interval?: number;
        metric: string;
        points: Array<{ timestamp: number; value: number }>;
        tags: string[];
        type: number;
      }>;
    };
    expect(payload.series).toEqual([
      {
        interval: 1,
        metric: "homerelay.verification.outcome_count",
        points: [{ timestamp: NOW / 1_000, value: 1 }],
        tags: [
          "service:homerelay",
          "env:verification",
          "source:synthetic_verifier",
          "data_class:synthetic",
          verifier.DATADOG_VERIFICATION_MARKER_TAG,
          "outcome:success",
        ],
        type: 1,
      },
      {
        interval: 1,
        metric: "homerelay.verification.outcome_count",
        points: [{ timestamp: NOW / 1_000, value: 1 }],
        tags: [
          "service:homerelay",
          "env:verification",
          "source:synthetic_verifier",
          "data_class:synthetic",
          verifier.DATADOG_VERIFICATION_MARKER_TAG,
          "outcome:failure",
        ],
        type: 1,
      },
      {
        metric: "homerelay.verification.duration_ms",
        points: [{ timestamp: NOW / 1_000, value: 125 }],
        tags: [
          "service:homerelay",
          "env:verification",
          "source:synthetic_verifier",
          "data_class:synthetic",
          verifier.DATADOG_VERIFICATION_MARKER_TAG,
          "outcome:success",
        ],
        type: 3,
      },
    ]);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(API_KEY);
    for (const forbidden of [
      "household_id",
      "user_id",
      "entry_id",
      "display_name",
      "photo",
      "audio",
      "exception",
      "stack",
      "昼食",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      payload.series.every((series) =>
        series.points.every((point) => typeof point.value === "number"),
      ),
    ).toBe(true);
  });

  it("rejects invalid key, site, timeout, or clock without network access", async () => {
    const cases = [
      liveEnvironment({ DD_API_KEY: "short" }),
      liveEnvironment({ DD_SITE: "attacker.example" }),
      liveEnvironment({ DATADOG_TIMEOUT_MS: "5001" }),
    ];
    for (const environment of cases) {
      const fetchImpl = vi.fn();
      await expect(
        verifier.verifyDatadog({ environment, fetchImpl }),
      ).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    }

    const fetchImpl = vi.fn();
    await expect(
      verifier.verifyDatadog({
        environment: liveEnvironment(),
        fetchImpl,
        now: () => Number.NaN,
      }),
    ).rejects.toThrow("DATADOG_CLOCK_INVALID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires the documented 202 acceptance and never reads vendor details", async () => {
    const secret = "vendor-detail-must-stay-private";
    const bodyReader = vi.fn().mockResolvedValue(secret);
    const fetchImpl = vi.fn().mockResolvedValue({
      headers: new Headers({ "X-Vendor-Detail": secret }),
      json: bodyReader,
      status: 200,
      text: bodyReader,
    });
    const logger = safeLogger();

    await expect(
      verifier.runDatadogVerifier({
        environment: liveEnvironment(),
        fetchImpl,
        logger,
      }),
    ).resolves.toBe(1);

    expect(bodyReader).not.toHaveBeenCalled();
    const output = [...logger.log.mock.calls, ...logger.error.mock.calls]
      .flat()
      .join(" ");
    expect(output).toContain("[verify-datadog] FAIL");
    expect(output).not.toContain(secret);
    expect(output).not.toContain(API_KEY);
  });

  it("prints the fixed marker only after acceptance", async () => {
    const logger = safeLogger();
    await expect(
      verifier.runDatadogVerifier({
        environment: liveEnvironment(),
        fetchImpl: vi.fn().mockResolvedValue({ status: 202 }),
        logger,
        now: () => NOW,
      }),
    ).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(verifier.DATADOG_VERIFICATION_MARKER_TAG),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
