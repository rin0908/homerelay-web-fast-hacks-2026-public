export const NEO4J_SCHEMA_CONSTRAINTS = Object.freeze([
  Object.freeze({
    name: "homerelay_household_id_unique",
    statement:
      "CREATE CONSTRAINT homerelay_household_id_unique IF NOT EXISTS FOR (node:HomeRelayHousehold) REQUIRE node.id IS UNIQUE",
  }),
  Object.freeze({
    name: "homerelay_member_household_id_unique",
    statement:
      "CREATE CONSTRAINT homerelay_member_household_id_unique IF NOT EXISTS FOR (node:HomeRelayMember) REQUIRE (node.householdId, node.id) IS UNIQUE",
  }),
  Object.freeze({
    name: "homerelay_handoff_household_id_unique",
    statement:
      "CREATE CONSTRAINT homerelay_handoff_household_id_unique IF NOT EXISTS FOR (node:HomeRelayHandoff) REQUIRE (node.householdId, node.id) IS UNIQUE",
  }),
  Object.freeze({
    name: "homerelay_needed_item_household_id_unique",
    statement:
      "CREATE CONSTRAINT homerelay_needed_item_household_id_unique IF NOT EXISTS FOR (node:HomeRelayNeededItem) REQUIRE (node.householdId, node.id) IS UNIQUE",
  }),
  Object.freeze({
    name: "homerelay_item_concept_household_fingerprint_unique",
    statement:
      "CREATE CONSTRAINT homerelay_item_concept_household_fingerprint_unique IF NOT EXISTS FOR (node:HomeRelayItemConcept) REQUIRE (node.householdId, node.fingerprint) IS UNIQUE",
  }),
]);

export async function applyNeo4jSchema(execute) {
  if (typeof execute !== "function") {
    throw new TypeError("A Neo4j Query API executor is required.");
  }

  for (const constraint of NEO4J_SCHEMA_CONSTRAINTS) {
    await execute(constraint.statement, {});
  }
  return NEO4J_SCHEMA_CONSTRAINTS.length;
}
