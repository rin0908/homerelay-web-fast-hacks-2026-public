import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  applyNeo4jSchema,
  NEO4J_SCHEMA_CONSTRAINTS,
} from "../../scripts/neo4j-schema.mjs";

const EXPECTED_NAMES = [
  "homerelay_household_id_unique",
  "homerelay_member_household_id_unique",
  "homerelay_handoff_household_id_unique",
  "homerelay_needed_item_household_id_unique",
  "homerelay_item_concept_household_fingerprint_unique",
] as const;

describe("Neo4j schema bootstrap allowlist", () => {
  it("contains only fixed, idempotent HomeRelay uniqueness constraints", () => {
    expect(NEO4J_SCHEMA_CONSTRAINTS.map(({ name }) => name)).toEqual(
      EXPECTED_NAMES,
    );
    expect(Object.isFrozen(NEO4J_SCHEMA_CONSTRAINTS)).toBe(true);

    for (const constraint of NEO4J_SCHEMA_CONSTRAINTS) {
      expect(Object.isFrozen(constraint)).toBe(true);
      expect(constraint.statement).toMatch(
        /^CREATE CONSTRAINT homerelay_[a-z_]+ IF NOT EXISTS FOR \(node:HomeRelay(?:Household|Member|Handoff|NeededItem|ItemConcept)\) REQUIRE (?:node\.id|\(node\.householdId, node\.(?:id|fingerprint)\)) IS UNIQUE$/,
      );
      expect(constraint.statement).not.toMatch(/[$\r\n;]/);
    }
  });

  it("executes every allowlisted statement with an empty parameter object", async () => {
    const execute = vi.fn().mockResolvedValue({ fields: [], values: [] });

    await expect(applyNeo4jSchema(execute)).resolves.toBe(
      NEO4J_SCHEMA_CONSTRAINTS.length,
    );
    expect(execute.mock.calls).toEqual(
      NEO4J_SCHEMA_CONSTRAINTS.map(({ statement }) => [statement, {}]),
    );
  });

  it.each(["bootstrap-neo4j.mjs", "verify-neo4j.mjs"])(
    "%s rejects redirects before sending Basic credentials",
    (filename) => {
      const source = readFileSync(
        resolve(process.cwd(), "scripts", filename),
        "utf8",
      );

      expect(source).toMatch(/redirect:\s*["']error["']/);
      expect(source).not.toMatch(/redirect:\s*["'](?:follow|manual)["']/);
    },
  );
});
