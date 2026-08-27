import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_DATADOG_SITE,
  DEFAULT_DATADOG_TIMEOUT_MS,
  getDatadogConfig,
  isDatadogConfigured,
  type DatadogEnvironment,
} from "@/lib/datadog/env";

const LIVE_ENVIRONMENT: DatadogEnvironment = {
  DD_API_KEY: "a".repeat(32),
  HOMERELAY_DATA_MODE: "supabase",
  HOMERELAY_DEMO_MODE: "false",
};

describe("Datadog environment", () => {
  it("returns a frozen server-only configuration for explicit live mode", () => {
    const config = getDatadogConfig({
      ...LIVE_ENVIRONMENT,
      DD_API_KEY: `  ${"a".repeat(32)}  `,
    });

    expect(config).toEqual({
      apiKey: "a".repeat(32),
      endpoint: "https://api.datadoghq.com/api/v2/series",
      environment: "live",
      site: DEFAULT_DATADOG_SITE,
      timeoutMs: DEFAULT_DATADOG_TIMEOUT_MS,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DATA_MODE: "demo" }],
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DATA_MODE: undefined }],
    [{ ...LIVE_ENVIRONMENT, HOMERELAY_DEMO_MODE: " TRUE " }],
  ])("never contacts Datadog outside explicit live data mode", (environment) => {
    expect(getDatadogConfig(environment)).toBeNull();
    expect(isDatadogConfigured(environment)).toBe(false);
  });

  it.each([
    [{ ...LIVE_ENVIRONMENT, DD_API_KEY: "" }],
    [{ ...LIVE_ENVIRONMENT, DD_API_KEY: "short" }],
    [{ ...LIVE_ENVIRONMENT, DD_API_KEY: `${"a".repeat(31)}!` }],
    [{ ...LIVE_ENVIRONMENT, DD_SITE: "attacker.example" }],
    [{ ...LIVE_ENVIRONMENT, DATADOG_TIMEOUT_MS: "249" }],
    [{ ...LIVE_ENVIRONMENT, DATADOG_TIMEOUT_MS: "5001" }],
    [{ ...LIVE_ENVIRONMENT, DATADOG_TIMEOUT_MS: "not-a-number" }],
  ])("rejects incomplete or unsafe configuration", (environment) => {
    expect(getDatadogConfig(environment)).toBeNull();
  });

  it.each([
    ["ap1.datadoghq.com", "https://api.ap1.datadoghq.com/api/v2/series"],
    ["ap2.datadoghq.com", "https://api.ap2.datadoghq.com/api/v2/series"],
    ["datadoghq.eu", "https://api.datadoghq.eu/api/v2/series"],
    ["ddog-gov.com", "https://api.ddog-gov.com/api/v2/series"],
    ["uk1.datadoghq.com", "https://api.uk1.datadoghq.com/api/v2/series"],
    ["us2.ddog-gov.com", "https://api.us2.ddog-gov.com/api/v2/series"],
    ["us3.datadoghq.com", "https://api.us3.datadoghq.com/api/v2/series"],
    ["us5.datadoghq.com", "https://api.us5.datadoghq.com/api/v2/series"],
  ])("maps the fixed site %s to its intake endpoint", (site, endpoint) => {
    expect(
      getDatadogConfig({
        ...LIVE_ENVIRONMENT,
        DD_SITE: site.toUpperCase(),
        DATADOG_TIMEOUT_MS: "2500",
      }),
    ).toMatchObject({ endpoint, site, timeoutMs: 2_500 });
  });

  it("accepts the legacy key only when it cannot conflict with DD_API_KEY", () => {
    expect(
      getDatadogConfig({
        ...LIVE_ENVIRONMENT,
        DD_API_KEY: undefined,
        DATADOG_API_KEY: "b".repeat(32),
      }),
    ).toMatchObject({ apiKey: "b".repeat(32) });

    expect(
      getDatadogConfig({
        ...LIVE_ENVIRONMENT,
        DATADOG_API_KEY: "b".repeat(32),
      }),
    ).toBeNull();
  });
});
