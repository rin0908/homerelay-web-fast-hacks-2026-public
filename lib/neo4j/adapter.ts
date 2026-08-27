import "server-only";

import { createHash } from "node:crypto";

import {
  createNeo4jClient,
  type Neo4jClientLike,
  type Neo4jQueryResult,
} from "@/lib/neo4j/client";
import { getNeo4jConfig, type Neo4jConfig } from "@/lib/neo4j/env";
import type {
  ConfirmedHandoffGraphInput,
  HandoffActionGraphInput,
  Neo4jSyncResult,
  PurchaseActionGraphInput,
} from "@/lib/neo4j/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NEEDED_ITEMS = 10;

export const CONFIRMED_HANDOFF_CYPHER = [
  "MERGE (household:HomeRelayHousehold {id: $householdId})",
  "MERGE (author:HomeRelayMember {id: $authorMemberId, householdId: $householdId})",
  "SET author.role = $authorRole",
  "MERGE (author)-[:MEMBER_OF]->(household)",
  "MERGE (handoff:HomeRelayHandoff {id: $entryId, householdId: $householdId})",
  "ON CREATE SET handoff.createdAt = $createdAt",
  "SET handoff.status = CASE WHEN coalesce(handoff.statusRank, 0) <= 1 THEN 'confirmed' ELSE handoff.status END, handoff.statusRank = CASE WHEN coalesce(handoff.statusRank, 0) <= 1 THEN 1 ELSE handoff.statusRank END",
  "MERGE (handoff)-[:BELONGS_TO]->(household)",
  "MERGE (author)-[:AUTHORED]->(handoff)",
  "FOREACH (item IN $items | MERGE (needed:HomeRelayNeededItem {id: item.id, householdId: $householdId}) ON CREATE SET needed.entryId = $entryId SET needed.state = CASE WHEN coalesce(needed.stateRank, 0) <= 1 THEN 'needed' ELSE needed.state END, needed.stateRank = CASE WHEN coalesce(needed.stateRank, 0) <= 1 THEN 1 ELSE needed.stateRank END MERGE (handoff)-[:NEEDS]->(needed) MERGE (concept:HomeRelayItemConcept {fingerprint: item.fingerprint, householdId: $householdId}) MERGE (needed)-[:INSTANCE_OF]->(concept))",
  "RETURN handoff.id AS entryId, size($items) AS itemCount",
].join(" ");

export const HANDOFF_ACTION_CYPHER = [
  "MERGE (household:HomeRelayHousehold {id: $householdId})",
  "MERGE (member:HomeRelayMember {id: $memberId, householdId: $householdId})",
  "SET member.role = $memberRole",
  "MERGE (member)-[:MEMBER_OF]->(household)",
  "MERGE (handoff:HomeRelayHandoff {id: $entryId, householdId: $householdId})",
  "MERGE (handoff)-[:BELONGS_TO]->(household)",
  "SET handoff.status = CASE WHEN coalesce(handoff.statusRank, 0) <= $statusRank THEN $status ELSE handoff.status END, handoff.statusRank = CASE WHEN coalesce(handoff.statusRank, 0) <= $statusRank THEN $statusRank ELSE handoff.statusRank END",
  "MERGE (member)-[event:HANDOFF_ACTION {eventKey: $eventKey}]->(handoff)",
  "SET event.action = $action, event.occurredAt = $occurredAt",
  "FOREACH (_ IN CASE WHEN $action IN ['claimed', 'done'] THEN [1] ELSE [] END | MERGE (member)-[:ASSIGNED_TO]->(handoff))",
  "RETURN handoff.id AS entryId, event.action AS action",
].join(" ");

export const PURCHASE_ACTION_CYPHER = [
  "MERGE (household:HomeRelayHousehold {id: $householdId})",
  "MERGE (member:HomeRelayMember {id: $memberId, householdId: $householdId})",
  "SET member.role = $memberRole",
  "MERGE (member)-[:MEMBER_OF]->(household)",
  "MERGE (handoff:HomeRelayHandoff {id: $entryId, householdId: $householdId})",
  "MERGE (handoff)-[:BELONGS_TO]->(household)",
  "MERGE (item:HomeRelayNeededItem {id: $itemId, householdId: $householdId})",
  "SET item.entryId = $entryId, item.state = CASE WHEN coalesce(item.stateRank, 0) <= $stateRank THEN $state ELSE item.state END, item.stateRank = CASE WHEN coalesce(item.stateRank, 0) <= $stateRank THEN $stateRank ELSE item.stateRank END",
  "MERGE (handoff)-[:NEEDS]->(item)",
  "MERGE (member)-[:PURCHASE_ASSIGNEE]->(item)",
  "MERGE (member)-[event:PURCHASE_ACTION {eventKey: $eventKey}]->(item)",
  "SET event.action = $action, event.occurredAt = $occurredAt",
  "RETURN item.id AS itemId, event.action AS action",
].join(" ");

function hash(parts: readonly string[]): string {
  const digest = createHash("sha256");
  for (const part of parts) {
    digest.update(part, "utf8");
    digest.update("\u0000", "utf8");
  }
  return digest.digest("hex");
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validRole(value: string): boolean {
  return value === "family" || value === "relative" || value === "helper";
}

function hasExpectedResult(
  result: Neo4jQueryResult,
  fields: readonly string[],
  values: readonly unknown[],
): boolean {
  return (
    result.fields.length === fields.length &&
    result.fields.every((field, index) => field === fields[index]) &&
    result.values.length === 1 &&
    result.values[0]?.length === values.length &&
    result.values[0]?.every((value, index) => value === values[index])
  );
}

function unavailable(
  reason: "invalid_input" | "invalid_response" | "not_configured" | "unavailable",
): Neo4jSyncResult {
  return { reason, relationshipCount: 0, status: "unavailable" };
}

function normalizedItems(
  input: ConfirmedHandoffGraphInput,
): readonly Readonly<{ fingerprint: string; id: string }>[] | null {
  if (input.neededItems.length > MAX_NEEDED_ITEMS) return null;

  const normalized = input.neededItems.map((item) => ({
    id: item.id,
    name: item.name.normalize("NFKC").trim().toLocaleLowerCase("ja-JP"),
  }));
  if (
    normalized.some(
      (item) =>
        !isUuid(item.id) || item.name.length === 0 || item.name.length > 120,
    ) ||
    new Set(normalized.map((item) => item.id)).size !== normalized.length ||
    new Set(normalized.map((item) => item.name)).size !== normalized.length
  ) {
    return null;
  }

  return normalized.map((item) => ({
    fingerprint: hash(["concept", input.householdId, item.name]),
    id: item.id,
  }));
}

function validConfirmedInput(input: ConfirmedHandoffGraphInput): boolean {
  return (
    isUuid(input.authorMemberId) &&
    isUuid(input.entryId) &&
    isUuid(input.householdId) &&
    validRole(input.authorRole) &&
    isTimestamp(input.createdAt)
  );
}

function validHandoffAction(input: HandoffActionGraphInput): boolean {
  return (
    isUuid(input.entryId) &&
    isUuid(input.householdId) &&
    isUuid(input.memberId) &&
    validRole(input.memberRole) &&
    ["confirmed", "claimed", "done"].includes(input.action) &&
    isTimestamp(input.occurredAt)
  );
}

function validPurchaseAction(input: PurchaseActionGraphInput): boolean {
  return (
    isUuid(input.entryId) &&
    isUuid(input.householdId) &&
    isUuid(input.itemId) &&
    isUuid(input.memberId) &&
    validRole(input.memberRole) &&
    ["purchase_intent", "purchased"].includes(input.action) &&
    isTimestamp(input.occurredAt)
  );
}

export class HomeRelayNeo4jAdapter {
  readonly #client: Neo4jClientLike | null;
  readonly #configured: boolean;

  constructor(client: Neo4jClientLike | null, configured: boolean) {
    this.#client = client;
    this.#configured = configured;
  }

  async syncConfirmedHandoff(
    input: ConfirmedHandoffGraphInput,
  ): Promise<Neo4jSyncResult> {
    if (!this.#configured || !this.#client) return unavailable("not_configured");
    if (!validConfirmedInput(input)) return unavailable("invalid_input");

    const items = normalizedItems(input);
    if (!items) return unavailable("invalid_input");

    try {
      const result = await this.#client.execute(CONFIRMED_HANDOFF_CYPHER, {
        authorMemberId: input.authorMemberId,
        authorRole: input.authorRole,
        createdAt: input.createdAt,
        entryId: input.entryId,
        householdId: input.householdId,
        items,
      });
      if (
        !hasExpectedResult(
          result,
          ["entryId", "itemCount"],
          [input.entryId, items.length],
        )
      ) {
        return unavailable("invalid_response");
      }
      return {
        relationshipCount: 3 + items.length * 2,
        status: "synced",
      };
    } catch {
      return unavailable("unavailable");
    }
  }

  async syncHandoffAction(
    input: HandoffActionGraphInput,
  ): Promise<Neo4jSyncResult> {
    if (!this.#configured || !this.#client) return unavailable("not_configured");
    if (!validHandoffAction(input)) return unavailable("invalid_input");

    const statusRank = { claimed: 2, confirmed: 1, done: 3 }[input.action];

    try {
      const result = await this.#client.execute(HANDOFF_ACTION_CYPHER, {
        action: input.action,
        entryId: input.entryId,
        eventKey: hash([
          "handoff-action",
          input.householdId,
          input.entryId,
          input.memberId,
          input.action,
        ]),
        householdId: input.householdId,
        memberId: input.memberId,
        memberRole: input.memberRole,
        occurredAt: input.occurredAt,
        status: input.action,
        statusRank,
      });
      if (
        !hasExpectedResult(
          result,
          ["entryId", "action"],
          [input.entryId, input.action],
        )
      ) {
        return unavailable("invalid_response");
      }
      return {
        relationshipCount: input.action === "confirmed" ? 3 : 4,
        status: "synced",
      };
    } catch {
      return unavailable("unavailable");
    }
  }

  async syncPurchaseAction(
    input: PurchaseActionGraphInput,
  ): Promise<Neo4jSyncResult> {
    if (!this.#configured || !this.#client) return unavailable("not_configured");
    if (!validPurchaseAction(input)) return unavailable("invalid_input");

    const stateRank = input.action === "purchased" ? 3 : 2;

    try {
      const result = await this.#client.execute(PURCHASE_ACTION_CYPHER, {
        action: input.action,
        entryId: input.entryId,
        eventKey: hash([
          "purchase-action",
          input.householdId,
          input.itemId,
          input.memberId,
          input.action,
        ]),
        householdId: input.householdId,
        itemId: input.itemId,
        memberId: input.memberId,
        memberRole: input.memberRole,
        occurredAt: input.occurredAt,
        state: input.action,
        stateRank,
      });
      if (
        !hasExpectedResult(
          result,
          ["itemId", "action"],
          [input.itemId, input.action],
        )
      ) {
        return unavailable("invalid_response");
      }
      return { relationshipCount: 5, status: "synced" };
    } catch {
      return unavailable("unavailable");
    }
  }
}

export function createNeo4jAdapter(options: {
  client?: Neo4jClientLike | null;
  config?: Neo4jConfig | null;
} = {}): HomeRelayNeo4jAdapter {
  const config = options.config === undefined ? getNeo4jConfig() : options.config;
  const client =
    options.client === undefined
      ? createNeo4jClient({ config })
      : options.client;
  return new HomeRelayNeo4jAdapter(client, Boolean(config));
}
