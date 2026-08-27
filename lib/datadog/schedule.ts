import "server-only";

import { after } from "next/server";

import { getDatadogConfig } from "@/lib/datadog/env";
import { createDatadogMetrics } from "@/lib/datadog/metrics";
import type {
  AiMetricMeasurement,
  ApiMetricMeasurement,
} from "@/lib/datadog/types";

export function scheduleApiMeasurement(
  measurement: ApiMetricMeasurement,
): boolean {
  const config = getDatadogConfig();
  if (!config) return false;

  try {
    const metrics = createDatadogMetrics({ config });
    after(async () => {
      await metrics.submitApiMeasurement(measurement);
    });
    return true;
  } catch {
    return false;
  }
}

export function scheduleAiMeasurement(
  measurement: AiMetricMeasurement,
): boolean {
  const config = getDatadogConfig();
  if (!config) return false;

  try {
    const metrics = createDatadogMetrics({ config });
    after(async () => {
      await metrics.submitAiMeasurement(measurement);
    });
    return true;
  } catch {
    return false;
  }
}
