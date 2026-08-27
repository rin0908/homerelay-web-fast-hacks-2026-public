import "server-only";

export const MAX_RELATED_RESULTS = 3;

export type QdrantPointType = "handoff" | "needed_item";

export type ConfirmedEntryForIndex = Readonly<{
  completedSummary: string;
  conditionSummary: string;
  createdAt: string;
  entryId: string;
  householdId: string;
  neededItems: readonly string[];
  nextRequest: string;
}>;

export type RelatedEntryQuery = Readonly<{
  currentEntryId: string;
  householdId: string;
  queryText: string;
  type: QdrantPointType;
}>;

export type QdrantUnavailableReason =
  | "invalid_input"
  | "invalid_response"
  | "not_configured"
  | "unavailable";

export type QdrantIndexResult =
  | Readonly<{ pointCount: number; status: "indexed" }>
  | Readonly<{
      pointCount: 0;
      reason: QdrantUnavailableReason;
      status: "unavailable";
    }>;

export type RelatedEntryResult = Readonly<{
  createdAt: string;
  displayText: string;
  entryId: string;
  pointId: number | string;
  score: number;
  type: QdrantPointType;
}>;

export type QdrantRelatedResult =
  | Readonly<{
      items: readonly RelatedEntryResult[];
      status: "available";
    }>
  | Readonly<{
      items: readonly [];
      reason: QdrantUnavailableReason;
      status: "unavailable";
    }>;
