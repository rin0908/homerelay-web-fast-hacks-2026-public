import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatadogMetrics } from "@/lib/datadog/metrics";
import type { DatadogConfig } from "@/lib/datadog/env";

const CONFIG: DatadogConfig = {
  apiKey: "a".repeat(32),
  endpoint: "https://api.ap1.datadoghq.com/api/v2/series",
  environment: "live",
  site: "ap1.datadoghq.com",
  timeoutMs: 1_250,
};
const NOW = Date.parse("2026-08-28T02:00:00.000Z");

function requestBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
    series: Array<Record<string, unknown>>;
  };
}

describe("DatadogMetrics", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errors: [] }), { status: 202 }));
  });

  it("submits only a numeric API duration with fixed low-cardinality tags", async () => {
    const metrics = createDatadogMetrics({
      config: CONFIG,
      fetch: fetchMock,
      now: () => NOW,
    });

    await expect(
      metrics.submitApiMeasurement({
        durationMs: 12.34567,
        route: "actions",
        status: 201,
      }),
    ).resolves.toEqual({ status: "submitted" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.ap1.datadoghq.com/api/v2/series",
      expect.objectContaining({
        cache: "no-store",
        method: "POST",
        redirect: "error",
      }),
    );
    expect(requestBody(fetchMock)).toEqual({
      series: [
        {
          metric: "homerelay.api.duration_ms",
          points: [{ timestamp: NOW / 1_000, value: 12.346 }],
          tags: [
            "service:homerelay",
            "env:live",
            "route:actions",
            "outcome:success",
          ],
          type: 3,
        },
      ],
    });
  });

  it("adds exactly one numeric error count for an unsuccessful API response", async () => {
    const metrics = createDatadogMetrics({
      config: CONFIG,
      fetch: fetchMock,
      now: () => NOW,
    });

    await metrics.submitApiMeasurement({
      durationMs: 44,
      route: "draft",
      status: 502,
    });

    expect(requestBody(fetchMock).series).toEqual([
      expect.objectContaining({
        metric: "homerelay.api.duration_ms",
        tags: expect.arrayContaining(["outcome:server_error"]),
        type: 3,
      }),
      {
        interval: 1,
        metric: "homerelay.api.error_count",
        points: [{ timestamp: NOW / 1_000, value: 1 }],
        tags: [
          "service:homerelay",
          "env:live",
          "route:draft",
          "outcome:server_error",
        ],
        type: 1,
      },
    ]);
  });

  it("submits only numeric AI duration and a fixed success/error outcome", async () => {
    const metrics = createDatadogMetrics({
      config: CONFIG,
      fetch: fetchMock,
      now: () => NOW,
    });

    await metrics.submitAiMeasurement({
      durationMs: 801.25,
      mode: "synthetic",
      outcome: "error",
    });

    expect(requestBody(fetchMock)).toEqual({
      series: [
        {
          metric: "homerelay.ai.duration_ms",
          points: [{ timestamp: NOW / 1_000, value: 801.25 }],
          tags: [
            "service:homerelay",
            "env:live",
            "route:draft",
            "mode:synthetic",
            "outcome:error",
          ],
          type: 3,
        },
      ],
    });
  });

  it("cannot serialize content, IDs, URLs, names, media, or exception details", async () => {
    const metrics = createDatadogMetrics({
      config: CONFIG,
      fetch: fetchMock,
      now: () => NOW,
    });
    await metrics.submitApiMeasurement({
      durationMs: 5,
      route: "related",
      status: 404,
    });

    const serialized = JSON.stringify(requestBody(fetchMock));
    for (const forbidden of [
      "photo",
      "audio",
      "display_name",
      "entry_id",
      "household_id",
      "http://",
      "https://",
      "stack",
      "exception",
      "昼食",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const series of requestBody(fetchMock).series) {
      const points = series.points as Array<{ value: unknown }>;
      expect(points.every((point) => typeof point.value === "number")).toBe(true);
    }
  });

  it("skips missing configuration and invalid measurements without network access", async () => {
    const unconfigured = createDatadogMetrics({ config: null, fetch: fetchMock });
    await expect(
      unconfigured.submitApiMeasurement({
        durationMs: 1,
        route: "draft",
        status: 200,
      }),
    ).resolves.toEqual({ reason: "not_configured", status: "skipped" });

    const configured = createDatadogMetrics({ config: CONFIG, fetch: fetchMock });
    await expect(
      configured.submitApiMeasurement({
        durationMs: Number.NaN,
        route: "draft",
        status: 200,
      }),
    ).resolves.toEqual({ reason: "invalid_input", status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns intake rejection or transport failure into a non-throwing result", async () => {
    const metrics = createDatadogMetrics({ config: CONFIG, fetch: fetchMock });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(
      metrics.submitAiMeasurement({
        durationMs: 3,
        mode: "openai",
        outcome: "success",
      }),
    ).resolves.toEqual({ status: "failed" });

    fetchMock.mockRejectedValueOnce(new Error("private vendor response"));
    await expect(
      metrics.submitAiMeasurement({
        durationMs: 3,
        mode: "openai",
        outcome: "error",
      }),
    ).resolves.toEqual({ status: "failed" });
  });
});
