import "server-only";

export const DATADOG_API_ROUTES = [
  "actions",
  "draft",
  "entries",
  "related",
] as const;

export type DatadogApiRoute = (typeof DATADOG_API_ROUTES)[number];
export type DatadogOutcome =
  | "client_error"
  | "server_error"
  | "success";
export type DatadogAiMode = "openai" | "synthetic";

export type ApiMetricMeasurement = Readonly<{
  durationMs: number;
  route: DatadogApiRoute;
  status: number;
}>;

export type AiMetricMeasurement = Readonly<{
  durationMs: number;
  mode: DatadogAiMode;
  outcome: "error" | "success";
}>;

export type DatadogSubmissionResult =
  | Readonly<{ status: "submitted" }>
  | Readonly<{ reason: "invalid_input" | "not_configured"; status: "skipped" }>
  | Readonly<{ status: "failed" }>;
