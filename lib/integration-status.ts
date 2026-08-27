import "server-only";

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
  supabaseAdmin: ServiceStatus;
  qdrant: ServiceStatus;
};

function hasEveryEnvironmentVariable(names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

export function getIntegrationStatus(): IntegrationStatus {
  const forcedDemo = process.env.HOMERELAY_DEMO_MODE === "true";
  const requestedDataMode =
    !forcedDemo && process.env.HOMERELAY_DATA_MODE === "supabase"
      ? "supabase"
      : "demo";
  const openaiConfigured = hasEveryEnvironmentVariable(["OPENAI_API_KEY"]);
  const supabaseConfigured = hasEveryEnvironmentVariable([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);
  const supabaseAdminConfigured = hasEveryEnvironmentVariable([
    "SUPABASE_SECRET_KEY",
  ]);
  const qdrantConfigured = hasEveryEnvironmentVariable([
    "QDRANT_URL",
    "QDRANT_API_KEY",
  ]);
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
    openai: service(openaiConfigured, !forcedDemo && openaiConfigured),
    supabase: service(
      supabaseConfigured,
      dataMode === "supabase" && supabaseConfigured,
    ),
    supabaseAdmin: service(
      supabaseAdminConfigured,
      dataMode === "supabase" && supabaseAdminConfigured,
    ),
    qdrant: service(qdrantConfigured, !forcedDemo && qdrantConfigured),
  };
}
