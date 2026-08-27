import "server-only";

import { getDatadogConfig, type DatadogConfig } from "@/lib/datadog/env";
import {
  DATADOG_API_ROUTES,
  type AiMetricMeasurement,
  type ApiMetricMeasurement,
  type DatadogOutcome,
  type DatadogSubmissionResult,
} from "@/lib/datadog/types";

const MAX_DURATION_MS = 5 * 60 * 1_000;
const GAUGE = 3;
const COUNT = 1;

type DatadogFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type MetricSeries = Readonly<{
  interval?: number;
  metric: "homerelay.ai.duration_ms" | "homerelay.api.duration_ms" | "homerelay.api.error_count";
  points: readonly [Readonly<{ timestamp: number; value: number }>];
  tags: readonly string[];
  type: typeof COUNT | typeof GAUGE;
}>;

export type DatadogMetricsOptions = Readonly<{
  config?: DatadogConfig | null;
  fetch?: DatadogFetch;
  now?: () => number;
}>;

function validDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_MS;
}

function normalizedDuration(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function apiOutcome(status: number): DatadogOutcome {
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  return "success";
}

function isAllowedRoute(value: string): boolean {
  return (DATADOG_API_ROUTES as readonly string[]).includes(value);
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class DatadogMetrics {
  readonly #config: DatadogConfig | null;
  readonly #fetch: DatadogFetch;
  readonly #now: () => number;

  constructor(options: DatadogMetricsOptions = {}) {
    this.#config = hasOwn(options, "config")
      ? (options.config ?? null)
      : getDatadogConfig();
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#now = options.now ?? Date.now;
  }

  async submitApiMeasurement(
    measurement: ApiMetricMeasurement,
  ): Promise<DatadogSubmissionResult> {
    if (!this.#config) return { reason: "not_configured", status: "skipped" };
    if (
      !validDuration(measurement.durationMs) ||
      !Number.isInteger(measurement.status) ||
      measurement.status < 100 ||
      measurement.status > 599 ||
      !isAllowedRoute(measurement.route)
    ) {
      return { reason: "invalid_input", status: "skipped" };
    }

    const outcome = apiOutcome(measurement.status);
    const tags = [
      "service:homerelay",
      `env:${this.#config.environment}`,
      `route:${measurement.route}`,
      `outcome:${outcome}`,
    ] as const;
    const series: MetricSeries[] = [
      this.#series(
        "homerelay.api.duration_ms",
        normalizedDuration(measurement.durationMs),
        GAUGE,
        tags,
      ),
    ];
    if (measurement.status >= 400) {
      series.push(
        this.#series("homerelay.api.error_count", 1, COUNT, tags, 1),
      );
    }
    return this.#submit(series);
  }

  async submitAiMeasurement(
    measurement: AiMetricMeasurement,
  ): Promise<DatadogSubmissionResult> {
    if (!this.#config) return { reason: "not_configured", status: "skipped" };
    if (
      !validDuration(measurement.durationMs) ||
      (measurement.mode !== "openai" && measurement.mode !== "synthetic") ||
      (measurement.outcome !== "success" && measurement.outcome !== "error")
    ) {
      return { reason: "invalid_input", status: "skipped" };
    }

    return this.#submit([
      this.#series(
        "homerelay.ai.duration_ms",
        normalizedDuration(measurement.durationMs),
        GAUGE,
        [
          "service:homerelay",
          `env:${this.#config.environment}`,
          "route:draft",
          `mode:${measurement.mode}`,
          `outcome:${measurement.outcome}`,
        ],
      ),
    ]);
  }

  #series(
    metric: MetricSeries["metric"],
    value: number,
    type: MetricSeries["type"],
    tags: readonly string[],
    interval?: number,
  ): MetricSeries {
    return {
      ...(interval === undefined ? {} : { interval }),
      metric,
      points: [
        {
          timestamp: Math.floor(this.#now() / 1_000),
          value,
        },
      ],
      tags,
      type,
    };
  }

  async #submit(series: readonly MetricSeries[]): Promise<DatadogSubmissionResult> {
    if (!this.#config) return { reason: "not_configured", status: "skipped" };
    try {
      const response = await this.#fetch(this.#config.endpoint, {
        body: JSON.stringify({ series }),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "DD-API-KEY": this.#config.apiKey,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
      return response.ok ? { status: "submitted" } : { status: "failed" };
    } catch {
      return { status: "failed" };
    }
  }
}

export function createDatadogMetrics(
  options?: DatadogMetricsOptions,
): DatadogMetrics {
  return new DatadogMetrics(options);
}
