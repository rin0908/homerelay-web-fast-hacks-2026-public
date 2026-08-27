import "server-only";

import type { MemberRole } from "@/types/handoff";

export type Neo4jUnavailableReason =
  | "invalid_input"
  | "invalid_response"
  | "not_configured"
  | "unavailable";

export type Neo4jSyncResult =
  | Readonly<{
      relationshipCount: number;
      status: "synced";
    }>
  | Readonly<{
      reason: Neo4jUnavailableReason;
      relationshipCount: 0;
      status: "unavailable";
    }>;

export type ConfirmedHandoffGraphInput = Readonly<{
  authorMemberId: string;
  authorRole: MemberRole;
  createdAt: string;
  entryId: string;
  householdId: string;
  neededItems: readonly Readonly<{ id: string; name: string }>[];
}>;

export type HandoffAction = "confirmed" | "claimed" | "done";

export type HandoffActionGraphInput = Readonly<{
  action: HandoffAction;
  entryId: string;
  householdId: string;
  memberId: string;
  memberRole: MemberRole;
  occurredAt: string;
}>;

export type PurchaseAction = "purchase_intent" | "purchased";

export type PurchaseActionGraphInput = Readonly<{
  action: PurchaseAction;
  entryId: string;
  householdId: string;
  itemId: string;
  memberId: string;
  memberRole: MemberRole;
  occurredAt: string;
}>;
