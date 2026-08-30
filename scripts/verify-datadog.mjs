import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
};

const DEFAULT_TIMEOUT_MS = 1_500;
const COUNT = 1;
const GAUGE = 3;
const SYNTHETIC_DURATION_MS = 125;

export const DATADOG_VERIFICATION_MARKER_TAG =
  "verification_marker:homerelay-datadog-live-v1";

const COMMON_VERIFICATION_TAGS = Object.freeze([
  "service:homerelay",
  "env:verification",
  "source:synthetic_verifier",
  "data_class:synthetic",
  DATADOG_VERIFICATION_MARKER_TAG,
]);

function timeoutMs(value) {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 250 && parsed <= 5_000
    ? parsed
    : null;
}

export function safeDatadogConfiguration(environment = process.env) {
  const apiKey = environment.DD_API_KEY?.trim();
  if (!apiKey) return null;

  const forcedDemo =
    environment.HOMERELAY_DEMO_MODE?.trim().toLowerCase() === "true";
  const isolated =
    environment.HOMERELAY_E2E_ISOLATE_VENDORS?.trim().toLowerCase() ===
    "true";
  const dataMode = environment.HOMERELAY_DATA_MODE?.trim().toLowerCase();
  if (forcedDemo || isolated || dataMode !== "supabase") return null;

  if (!/^[A-Za-z0-9]{32,64}$/.test(apiKey)) {
    throw new Error("DD_API_KEY_INVALID");
  }

  const site =
    environment.DD_SITE?.trim().toLowerCase() || "datadoghq.com";
  const endpoint = SITE_ENDPOINTS[site];
  const timeout = timeoutMs(environment.DATADOG_TIMEOUT_MS);
  if (!endpoint) throw new Error("DD_SITE_UNSUPPORTED");
  if (timeout === null) throw new Error("DATADOG_TIMEOUT_INVALID");

  return Object.freeze({ apiKey, endpoint, timeoutMs: timeout });
}

export function syntheticVerificationSeries(nowMs = Date.now()) {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new Error("DATADOG_CLOCK_INVALID");
  }
  const timestamp = Math.floor(nowMs / 1_000);
  const outcomeCount = (outcome) => ({
    interval: 1,
    metric: "homerelay.verification.outcome_count",
    points: [{ timestamp, value: 1 }],
    tags: [...COMMON_VERIFICATION_TAGS, `outcome:${outcome}`],
    type: COUNT,
  });

  return [
    outcomeCount("success"),
    outcomeCount("failure"),
    {
      metric: "homerelay.verification.duration_ms",
      points: [{ timestamp, value: SYNTHETIC_DURATION_MS }],
      tags: [...COMMON_VERIFICATION_TAGS, "outcome:success"],
      type: GAUGE,
    },
  ];
}

export async function verifyDatadog({
  abortSignalFactory = (milliseconds) => AbortSignal.timeout(milliseconds),
  environment = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const config = safeDatadogConfiguration(environment);
  if (!config) return { status: "skipped" };

  const response = await fetchImpl(config.endpoint, {
    body: JSON.stringify({ series: syntheticVerificationSeries(now()) }),
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "DD-API-KEY": config.apiKey,
    },
    method: "POST",
    redirect: "error",
    signal: abortSignalFactory(config.timeoutMs),
  });

  // The metrics intake contract accepts a valid payload with HTTP 202. Never
  // inspect a vendor body or header because neither is needed for this proof.
  if (response.status !== 202) throw new Error("METRIC_INTAKE_REJECTED");
  return { status: "accepted" };
}

export async function runDatadogVerifier({ logger = console, ...options } = {}) {
  try {
    const result = await verifyDatadog(options);
    if (result.status === "skipped") {
      logger.log(
        "[verify-datadog] SKIP / 未接続: 明示的Supabase live modeとDD_API_KEYが揃っていないため外部通信していません。",
      );
      return 0;
    }

    logger.log(
      `[verify-datadog] PASS: 合成success/failure countと処理時間を受理。UI filter: ${DATADOG_VERIFICATION_MARKER_TAG}（数値・固定tagのみ）。`,
    );
    return 0;
  } catch {
    logger.error(
      "[verify-datadog] FAIL: metrics intake、site、live mode、またはtimeoutを確認してください（vendor詳細・本文・認証情報は非表示）。",
    );
    return 1;
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  process.exitCode = await runDatadogVerifier();
}
