import "server-only";

export const DEFAULT_NEO4J_DATABASE = "neo4j";
export const DEFAULT_NEO4J_TIMEOUT_MS = 4_000;

const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 15_000;

export type Neo4jEnvironment = {
  HOMERELAY_DATA_MODE?: string;
  HOMERELAY_DEMO_MODE?: string;
  HOMERELAY_E2E_ISOLATE_VENDORS?: string;
  NEO4J_DATABASE?: string;
  NEO4J_PASSWORD?: string;
  NEO4J_TIMEOUT_MS?: string;
  NEO4J_URI?: string;
  NEO4J_USERNAME?: string;
};

export type Neo4jConfig = Readonly<{
  database: string;
  password: string;
  queryApiUrl: string;
  timeoutMs: number;
  username: string;
}>;

function currentEnvironment(): Neo4jEnvironment {
  return {
    HOMERELAY_DATA_MODE: process.env.HOMERELAY_DATA_MODE,
    HOMERELAY_DEMO_MODE: process.env.HOMERELAY_DEMO_MODE,
    HOMERELAY_E2E_ISOLATE_VENDORS:
      process.env.HOMERELAY_E2E_ISOLATE_VENDORS,
    NEO4J_DATABASE: process.env.NEO4J_DATABASE,
    NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
    NEO4J_TIMEOUT_MS: process.env.NEO4J_TIMEOUT_MS,
    NEO4J_URI: process.env.NEO4J_URI,
    NEO4J_USERNAME: process.env.NEO4J_USERNAME,
  };
}

function isExplicitLiveMode(environment: Neo4jEnvironment): boolean {
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

function validDatabase(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(value);
}

function validCredential(value: string, maximum: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function parseTimeout(value: string | undefined): number | null {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_NEO4J_TIMEOUT_MS;
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) &&
    parsed >= MIN_TIMEOUT_MS &&
    parsed <= MAX_TIMEOUT_MS
    ? parsed
    : null;
}

function queryApiUrl(value: string, database: string): string | null {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";

    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "" && url.pathname !== "/")
    ) {
      return null;
    }

    if (url.protocol === "neo4j+s:") {
      return `https://${url.host}/db/${encodeURIComponent(database)}/query/v2`;
    } else if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && loopback)
    ) {
      return null;
    }

    const origin = url.toString().replace(/\/$/, "");
    return `${origin}/db/${encodeURIComponent(database)}/query/v2`;
  } catch {
    return null;
  }
}

export function getNeo4jConfig(
  environment: Neo4jEnvironment = currentEnvironment(),
): Neo4jConfig | null {
  if (!isExplicitLiveMode(environment)) return null;

  const database =
    environment.NEO4J_DATABASE?.trim() || DEFAULT_NEO4J_DATABASE;
  const password = environment.NEO4J_PASSWORD ?? "";
  const username = environment.NEO4J_USERNAME?.trim() ?? "";
  const timeoutMs = parseTimeout(environment.NEO4J_TIMEOUT_MS);
  const endpoint = queryApiUrl(environment.NEO4J_URI?.trim() ?? "", database);

  if (
    !validDatabase(database) ||
    !validCredential(username, 128) ||
    username.includes(":") ||
    !validCredential(password, 1_024) ||
    timeoutMs === null ||
    !endpoint
  ) {
    return null;
  }

  return Object.freeze({
    database,
    password,
    queryApiUrl: endpoint,
    timeoutMs,
    username,
  });
}

export function isNeo4jConfigured(
  environment?: Neo4jEnvironment,
): boolean {
  return getNeo4jConfig(environment) !== null;
}
