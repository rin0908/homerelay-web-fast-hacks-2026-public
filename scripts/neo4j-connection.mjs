export {
  DEFAULT_NEO4J_DATABASE,
  resolveNeo4jDatabase,
} from "../lib/neo4j/database-resolution.mjs";

export function isNeo4jLiveMode(environment) {
  const forcedDemo =
    environment.HOMERELAY_DEMO_MODE?.trim().toLowerCase() === "true";
  const isolated =
    environment.HOMERELAY_E2E_ISOLATE_VENDORS?.trim().toLowerCase() ===
    "true";
  return (
    !forcedDemo &&
    !isolated &&
    environment.HOMERELAY_DATA_MODE?.trim().toLowerCase() === "supabase"
  );
}
