export const DEFAULT_NEO4J_DATABASE = "neo4j";

const AURA_INSTANCE_HOST = /^([a-z0-9]{8})\.databases\.neo4j\.io$/i;
const AURA_INSTANCE_USERNAME = /^[a-z0-9]{8}$/i;

/**
 * Resolve the database used by both the application runtime and Node scripts.
 * This module is deliberately environment- and credential-agnostic so both
 * callers apply the same Aura Free instance rule without importing secrets.
 */
export function resolveNeo4jDatabase({ explicitDatabase, uri, username }) {
  const explicit = explicitDatabase?.trim();
  if (explicit) return explicit;

  try {
    const parsedUri = uri instanceof URL ? uri : new URL(uri);
    const normalizedUsername = username.trim();
    const hostMatch = AURA_INSTANCE_HOST.exec(parsedUri.hostname);
    const safeAuraUri =
      (parsedUri.protocol === "neo4j+s:" || parsedUri.protocol === "https:") &&
      parsedUri.port === "" &&
      !parsedUri.username &&
      !parsedUri.password &&
      !parsedUri.search &&
      !parsedUri.hash &&
      (parsedUri.pathname === "" || parsedUri.pathname === "/");

    if (
      safeAuraUri &&
      hostMatch &&
      AURA_INSTANCE_USERNAME.test(normalizedUsername) &&
      hostMatch[1].toLowerCase() === normalizedUsername.toLowerCase()
    ) {
      return normalizedUsername;
    }
  } catch {
    // Callers retain their existing validation and reject malformed URIs.
  }

  return DEFAULT_NEO4J_DATABASE;
}
