import "server-only";

export type IntegrationMode = "live" | "demo";

export type IntegrationStatus = {
  appMode: IntegrationMode;
  openai: IntegrationMode;
  supabase: IntegrationMode;
  qdrant: IntegrationMode;
};

function hasEveryEnvironmentVariable(names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

export function getIntegrationStatus(): IntegrationStatus {
  const forcedDemo = process.env.HOMERELAY_DEMO_MODE === "true";
  const openai = !forcedDemo && hasEveryEnvironmentVariable(["OPENAI_API_KEY"]);
  const supabase =
    !forcedDemo &&
    hasEveryEnvironmentVariable([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ]);
  const qdrant =
    !forcedDemo && hasEveryEnvironmentVariable(["QDRANT_URL", "QDRANT_API_KEY"]);

  return {
    appMode: openai && supabase && qdrant ? "live" : "demo",
    openai: openai ? "live" : "demo",
    supabase: supabase ? "live" : "demo",
    qdrant: qdrant ? "live" : "demo",
  };
}
