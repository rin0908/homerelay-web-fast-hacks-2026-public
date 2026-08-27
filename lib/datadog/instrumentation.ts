import "server-only";

import {
  scheduleAiMeasurement,
  scheduleApiMeasurement,
} from "@/lib/datadog/schedule";
import type {
  AiMetricMeasurement,
  ApiMetricMeasurement,
  DatadogAiMode,
  DatadogApiRoute,
} from "@/lib/datadog/types";

type Clock = () => number;
type ApiScheduler = (measurement: ApiMetricMeasurement) => boolean;
type AiScheduler = (measurement: AiMetricMeasurement) => boolean;

export type ApiInstrumentationOptions = Readonly<{
  now?: Clock;
  schedule?: ApiScheduler;
}>;

export type AiInstrumentationOptions = Readonly<{
  modeOnError: DatadogAiMode;
  now?: Clock;
  schedule?: AiScheduler;
}>;

function elapsed(startedAt: number, now: Clock): number {
  return Math.max(0, now() - startedAt);
}

function safelySchedule<T>(schedule: (measurement: T) => boolean, value: T) {
  try {
    schedule(value);
  } catch {
    // Metrics must never change the application result.
  }
}

export function withApiMetrics<Arguments extends unknown[]>(
  route: DatadogApiRoute,
  handler: (...args: Arguments) => Promise<Response>,
  options: ApiInstrumentationOptions = {},
): (...args: Arguments) => Promise<Response> {
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? scheduleApiMeasurement;

  return async (...args: Arguments) => {
    const startedAt = now();
    try {
      const response = await handler(...args);
      safelySchedule(schedule, {
        durationMs: elapsed(startedAt, now),
        route,
        status: response.status,
      });
      return response;
    } catch (error) {
      safelySchedule(schedule, {
        durationMs: elapsed(startedAt, now),
        route,
        status: 500,
      });
      throw error;
    }
  };
}

export async function withAiMetrics<Result extends { mode: "demo" | "live" }>(
  operation: () => Promise<Result>,
  options: AiInstrumentationOptions,
): Promise<Result> {
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? scheduleAiMeasurement;
  const startedAt = now();

  try {
    const result = await operation();
    safelySchedule(schedule, {
      durationMs: elapsed(startedAt, now),
      mode: result.mode === "live" ? "openai" : "synthetic",
      outcome: "success",
    });
    return result;
  } catch (error) {
    safelySchedule(schedule, {
      durationMs: elapsed(startedAt, now),
      mode: options.modeOnError,
      outcome: "error",
    });
    throw error;
  }
}
