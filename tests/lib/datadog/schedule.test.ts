import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getDatadogConfig: vi.fn(),
  submitAiMeasurement: vi.fn(),
  submitApiMeasurement: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/datadog/env", () => ({
  getDatadogConfig: mocks.getDatadogConfig,
}));
vi.mock("@/lib/datadog/metrics", () => ({
  createDatadogMetrics: () => ({
    submitAiMeasurement: mocks.submitAiMeasurement,
    submitApiMeasurement: mocks.submitApiMeasurement,
  }),
}));

import {
  scheduleAiMeasurement,
  scheduleApiMeasurement,
} from "@/lib/datadog/schedule";

describe("Datadog after-response scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitAiMeasurement.mockResolvedValue({ status: "submitted" });
    mocks.submitApiMeasurement.mockResolvedValue({ status: "submitted" });
  });

  it("does not register work when credentials are absent", () => {
    mocks.getDatadogConfig.mockReturnValue(null);

    expect(
      scheduleApiMeasurement({
        durationMs: 2,
        route: "draft",
        status: 200,
      }),
    ).toBe(false);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("registers submission after the response and never awaits it inline", async () => {
    mocks.getDatadogConfig.mockReturnValue({ configured: true });
    let callback: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((value: () => Promise<void>) => {
      callback = value;
    });
    const measurement = {
      durationMs: 4,
      route: "entries" as const,
      status: 503,
    };

    expect(scheduleApiMeasurement(measurement)).toBe(true);
    expect(mocks.submitApiMeasurement).not.toHaveBeenCalled();
    await callback?.();
    expect(mocks.submitApiMeasurement).toHaveBeenCalledWith(measurement);
  });

  it("schedules AI duration and absorbs an unavailable request context", async () => {
    mocks.getDatadogConfig.mockReturnValue({ configured: true });
    let callback: (() => Promise<void>) | undefined;
    mocks.after.mockImplementationOnce((value: () => Promise<void>) => {
      callback = value;
    });
    const measurement = {
      durationMs: 9,
      mode: "openai" as const,
      outcome: "error" as const,
    };

    expect(scheduleAiMeasurement(measurement)).toBe(true);
    await callback?.();
    expect(mocks.submitAiMeasurement).toHaveBeenCalledWith(measurement);

    mocks.after.mockImplementationOnce(() => {
      throw new Error("no request context");
    });
    expect(scheduleAiMeasurement(measurement)).toBe(false);
  });
});
