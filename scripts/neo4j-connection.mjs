export const DEFAULT_NEO4J_DATABASE = "neo4j";

const AURA_INSTANCE_HOST = /^([a-z0-9]{8})\.databases\.neo4j\.io$/i;
const AURA_INSTANCE_USERNAME = /^[a-z0-9]{8}$/i;

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

export function resolveNeo4jDatabase({ explicitDatabase, uri, username }) {
  const explicit = explicitDatabase?.trim();
  if (explicit) return explicit;

  const normalizedUsername = username.trim();
  const hostMatch = AURA_INSTANCE_HOST.exec(uri.hostname);
  const safeAuraUri =
    (uri.protocol === "neo4j+s:" || uri.protocol === "https:") &&
    uri.port === "" &&
    !uri.username &&
    !uri.password &&
    !uri.search &&
    !uri.hash &&
    (uri.pathname === "" || uri.pathname === "/");
  if (
    safeAuraUri &&
    hostMatch &&
    AURA_INSTANCE_USERNAME.test(normalizedUsername) &&
    hostMatch[1].toLowerCase() === normalizedUsername.toLowerCase()
  ) {
    return normalizedUsername;
  }

  return DEFAULT_NEO4J_DATABASE;
}
