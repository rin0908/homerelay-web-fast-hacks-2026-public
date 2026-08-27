import "server-only";

import { after } from "next/server";

import { createNeo4jAdapter } from "@/lib/neo4j/adapter";
import { getNeo4jConfig } from "@/lib/neo4j/env";
import type {
  ConfirmedHandoffGraphInput,
  HandoffActionGraphInput,
  PurchaseActionGraphInput,
} from "@/lib/neo4j/types";

type GraphSyncInput =
  | Readonly<{ kind: "confirmed"; value: ConfirmedHandoffGraphInput }>
  | Readonly<{ kind: "handoff-action"; value: HandoffActionGraphInput }>
  | Readonly<{ kind: "purchase-action"; value: PurchaseActionGraphInput }>;

function scheduleGraphSync(input: GraphSyncInput): boolean {
  const config = getNeo4jConfig();
  if (!config) return false;

  try {
    const adapter = createNeo4jAdapter({ config });
    after(async () => {
      if (input.kind === "confirmed") {
        await adapter.syncConfirmedHandoff(input.value);
      } else if (input.kind === "handoff-action") {
        await adapter.syncHandoffAction(input.value);
      } else {
        await adapter.syncPurchaseAction(input.value);
      }
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Schedules privacy-minimized relationship indexing after Supabase has already
 * committed the confirmed handoff. Neo4j can never change the share result.
 */
export function scheduleConfirmedHandoffGraphSync(
  input: ConfirmedHandoffGraphInput,
): boolean {
  return scheduleGraphSync({ kind: "confirmed", value: input });
}

export function scheduleHandoffActionGraphSync(
  input: HandoffActionGraphInput,
): boolean {
  return scheduleGraphSync({ kind: "handoff-action", value: input });
}

export function schedulePurchaseActionGraphSync(
  input: PurchaseActionGraphInput,
): boolean {
  return scheduleGraphSync({ kind: "purchase-action", value: input });
}
