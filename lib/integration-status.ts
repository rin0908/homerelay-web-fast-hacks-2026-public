import "server-only";

import { isDatadogConfigured } from "@/lib/datadog/env";
import { isNeo4jConfigured } from "@/lib/neo4j/env";
import { isQdrantConfigured } from "@/lib/qdrant/env";

export type IntegrationMode = "live" | "demo";
export type DataMode = "demo" | "supabase" | "misconfigured";

export type ServiceStatus = {
  configured: boolean;
  active: boolean;
  connectionVerified: false;
};

export type IntegrationStatus = {
  /** Compatibility label for the existing shell. Use dataMode for routing decisions. */
  appMode: IntegrationMode;
  requestedDataMode: Exclude<DataMode, "misconfigured">;
  dataMode: DataMode;
  configurationIssue?: "supabase_public_config_missing";
  openai: ServiceStatus;
  supabase: ServiceStatus;
  qdrant: ServiceStatus;
  neo4j: ServiceStatus;
  datadog: ServiceStatus;
};

function hasEveryEnvironmentVariable(names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

export function getIntegrationStatus(): IntegrationStatus {
  const forcedDemo = process.env.HOMERELAY_DEMO_MODE === "true";
  const explicitLiveApp = process.env.HOMERELAY_DEMO_MODE === "false";
  const isolateVendors =
    process.env.HOMERELAY_E2E_ISOLATE_VENDORS === "true";
  const requestedDataMode =
    !forcedDemo &&
    (explicitLiveApp || process.env.HOMERELAY_DATA_MODE === "supabase")
      ? "supabase"
      : "demo";
  const openaiConfigured = hasEveryEnvironmentVariable([
    "OPENAI_API_KEY",
    "OPENAI_PROJECT_ID",
  ]);
  const supabaseConfigured = hasEveryEnvironmentVariable([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);
  const qdrantConfigured = hasEveryEnvironmentVariable([
    "QDRANT_URL",
    "QDRANT_API_KEY",
  ]);
  const qdrantLiveConfigured = isQdrantConfigured();
  const neo4jConfigured = hasEveryEnvironmentVariable([
    "NEO4J_URI",
    "NEO4J_USERNAME",
    "NEO4J_PASSWORD",
  ]);
  const neo4jLiveConfigured = isNeo4jConfigured();
  const datadogConfigured = Boolean(
    process.env.DD_API_KEY?.trim() || process.env.DATADOG_API_KEY?.trim(),
  );
  const datadogLiveConfigured = isDatadogConfigured();
  const dataMode: DataMode =
    requestedDataMode === "demo"
      ? "demo"
      : supabaseConfigured
        ? "supabase"
        : "misconfigured";

  const service = (configured: boolean, active: boolean): ServiceStatus => ({
    configured,
    active,
    connectionVerified: false,
  });

  return {
    appMode: dataMode === "supabase" ? "live" : "demo",
    requestedDataMode,
    dataMode,
    ...(dataMode === "misconfigured"
      ? { configurationIssue: "supabase_public_config_missing" as const }
      : {}),
    openai: service(
      openaiConfigured,
      dataMode === "supabase" && openaiConfigured && !isolateVendors,
    ),
    supabase: service(
      supabaseConfigured,
      dataMode === "supabase" && supabaseConfigured,
    ),
    qdrant: service(
      qdrantConfigured,
      dataMode === "supabase" && qdrantLiveConfigured,
    ),
    neo4j: service(
      neo4jConfigured,
      dataMode === "supabase" && neo4jLiveConfigured,
    ),
    datadog: service(
      datadogConfigured,
      dataMode === "supabase" && datadogLiveConfigured,
    ),
  };
}
