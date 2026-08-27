export type Neo4jSchemaConstraint = Readonly<{
  name: string;
  statement: string;
}>;

export const NEO4J_SCHEMA_CONSTRAINTS: readonly Neo4jSchemaConstraint[];

export function applyNeo4jSchema(
  execute: (
    statement: string,
    parameters: Readonly<Record<string, never>>,
  ) => Promise<unknown>,
): Promise<number>;
