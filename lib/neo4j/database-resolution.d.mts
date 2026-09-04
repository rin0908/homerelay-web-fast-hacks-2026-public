export const DEFAULT_NEO4J_DATABASE: "neo4j";

export function resolveNeo4jDatabase(input: {
  explicitDatabase?: string;
  uri: string | URL;
  username: string;
}): string;
