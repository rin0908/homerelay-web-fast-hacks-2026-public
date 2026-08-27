import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  withAiMetrics,
  withApiMetrics,
} from "@/lib/datadog/instrumentation";

function clock(...values: number[]) {
  const now = vi.fn();
  for (const value of values) now.mockReturnValueOnce(value);
  return now;
}

describe("Datadog instrumentation", () => {
  it("returns the exact API response while scheduling numeric duration/status", async () => {
    const response = new Response("synthetic", { status: 201 });
    const handler = vi.fn(async (request: Request) => {
      expect(request).toBeInstanceOf(Request);
      return response;
    });
    const schedule = vi.fn(() => true);
    const wrapped = withApiMetrics("entries", handler, {
      now: clock(10, 31.5),
      schedule,
    });

    await expect(wrapped(new Request("http://local/"))).resolves.toBe(response);
    expect(schedule).toHaveBeenCalledWith({
      durationMs: 21.5,
      route: "entries",
      status: 201,
    });
  });

  it("preserves thrown errors without sending their message or stack", async () => {
    const privateError = new Error("private handoff body and identifier");
    const schedule = vi.fn(() => true);
    const wrapped = withApiMetrics(
      "related",
      async () => {
        throw privateError;
      },
      { now: clock(50, 58), schedule },
    );

    await expect(wrapped()).rejects.toBe(privateError);
    expect(schedule).toHaveBeenCalledWith({
      durationMs: 8,
      route: "related",
      status: 500,
    });
    expect(JSON.stringify(schedule.mock.calls)).not.toContain(privateError.message);
  });

  it("never lets scheduler failure change a successful API response", async () => {
    const response = new Response(null, { status: 204 });
    const wrapped = withApiMetrics("draft", async () => response, {
      now: clock(1, 2),
      schedule: () => {
        throw new Error("synthetic scheduler failure");
      },
    });

    await expect(wrapped()).resolves.toBe(response);
  });

  it("measures successful and failed AI operations without altering results", async () => {
    const successSchedule = vi.fn(() => true);
    await expect(
      withAiMetrics(async () => ({ mode: "demo" as const }), {
        modeOnError: "synthetic",
        now: clock(100, 125),
        schedule: successSchedule,
      }),
    ).resolves.toEqual({ mode: "demo" });
    expect(successSchedule).toHaveBeenCalledWith({
      durationMs: 25,
      mode: "synthetic",
      outcome: "success",
    });

    const privateError = new Error("private transcript");
    const errorSchedule = vi.fn(() => true);
    await expect(
      withAiMetrics(
        async () => {
          throw privateError;
        },
        {
          modeOnError: "openai",
          now: clock(200, 209),
          schedule: errorSchedule,
        },
      ),
    ).rejects.toBe(privateError);
    expect(errorSchedule).toHaveBeenCalledWith({
      durationMs: 9,
      mode: "openai",
      outcome: "error",
    });
    expect(JSON.stringify(errorSchedule.mock.calls)).not.toContain(
      privateError.message,
    );
  });
});
