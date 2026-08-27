import "server-only";

export const DEFAULT_DATADOG_SITE = "datadoghq.com";
export const DEFAULT_DATADOG_TIMEOUT_MS = 1_500;

const SITE_ENDPOINTS = {
  "ap1.datadoghq.com": "https://api.ap1.datadoghq.com/api/v2/series",
  "ap2.datadoghq.com": "https://api.ap2.datadoghq.com/api/v2/series",
  "datadoghq.com": "https://api.datadoghq.com/api/v2/series",
  "datadoghq.eu": "https://api.datadoghq.eu/api/v2/series",
  "ddog-gov.com": "https://api.ddog-gov.com/api/v2/series",
  "uk1.datadoghq.com": "https://api.uk1.datadoghq.com/api/v2/series",
  "us2.ddog-gov.com": "https://api.us2.ddog-gov.com/api/v2/series",
  "us3.datadoghq.com": "https://api.us3.datadoghq.com/api/v2/series",
  "us5.datadoghq.com": "https://api.us5.datadoghq.com/api/v2/series",
} as const;

export type DatadogSite = keyof typeof SITE_ENDPOINTS;

export type DatadogEnvironment = {
  DD_API_KEY?: string;
  DD_SITE?: string;
  /** Transitional compatibility only. Prefer DD_API_KEY. */
  DATADOG_API_KEY?: string;
  DATADOG_TIMEOUT_MS?: string;
  HOMERELAY_DATA_MODE?: string;
  HOMERELAY_DEMO_MODE?: string;
};

export type DatadogConfig = Readonly<{
  apiKey: string;
  endpoint: string;
  environment: "live";
  site: DatadogSite;
  timeoutMs: number;
}>;

function currentEnvironment(): DatadogEnvironment {
  return {
    DD_API_KEY: process.env.DD_API_KEY,
    DD_SITE: process.env.DD_SITE,
    DATADOG_API_KEY: process.env.DATADOG_API_KEY,
    DATADOG_TIMEOUT_MS: process.env.DATADOG_TIMEOUT_MS,
    HOMERELAY_DATA_MODE: process.env.HOMERELAY_DATA_MODE,
    HOMERELAY_DEMO_MODE: process.env.HOMERELAY_DEMO_MODE,
  };
}

function parseTimeout(value: string | undefined): number | null {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_DATADOG_TIMEOUT_MS;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 250 && parsed <= 5_000
    ? parsed
    : null;
}

function isDatadogSite(value: string): value is DatadogSite {
  return Object.prototype.hasOwnProperty.call(SITE_ENDPOINTS, value);
}

export function getDatadogConfig(
  environment: DatadogEnvironment = currentEnvironment(),
): DatadogConfig | null {
  const forcedDemo =
    environment.HOMERELAY_DEMO_MODE?.trim().toLowerCase() === "true";
  const dataMode = environment.HOMERELAY_DATA_MODE?.trim().toLowerCase();
  if (forcedDemo || dataMode !== "supabase") return null;

  const canonicalApiKey = environment.DD_API_KEY?.trim() ?? "";
  const legacyApiKey = environment.DATADOG_API_KEY?.trim() ?? "";
  if (canonicalApiKey && legacyApiKey && canonicalApiKey !== legacyApiKey) {
    return null;
  }
  const apiKey = canonicalApiKey || legacyApiKey;
  const site = (
    environment.DD_SITE?.trim().toLowerCase() || DEFAULT_DATADOG_SITE
  );
  const timeoutMs = parseTimeout(environment.DATADOG_TIMEOUT_MS);

  if (
    !/^[A-Za-z0-9]{32,64}$/.test(apiKey) ||
    !isDatadogSite(site) ||
    timeoutMs === null
  ) {
    return null;
  }

  return Object.freeze({
    apiKey,
    endpoint: SITE_ENDPOINTS[site],
    environment: "live" as const,
    site,
    timeoutMs,
  });
}

export function isDatadogConfigured(
  environment?: DatadogEnvironment,
): boolean {
  return getDatadogConfig(environment) !== null;
}
