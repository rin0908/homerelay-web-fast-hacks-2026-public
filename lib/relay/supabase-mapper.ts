import type {
  EntryStatus,
  HandoffEntry,
  MemberRole,
  MemberSummary,
  NeededItem,
  NeededItemStatus,
} from "@/types/handoff";

export type SupabaseMemberRow = {
  id: string;
  display_name: string;
  role: string;
};

export type SupabaseNeededItemRow = {
  id: string;
  name: string;
  status: string;
  claimed_by: SupabaseMemberRow | null;
  updated_at: string;
};

export type SupabaseEntryRow = {
  id: string;
  household_id: string;
  author: SupabaseMemberRow;
  claimed_by: SupabaseMemberRow | null;
  photo_path: string;
  photo_alt: string;
  condition_summary: string;
  completed_summary: string;
  next_request: string;
  status: string;
  needed_items: SupabaseNeededItemRow[];
  created_at: string;
};

export class SupabaseEntryMappingError extends Error {
  readonly code = "INVALID_SUPABASE_ENTRY";

  constructor() {
    super("Supabaseの申し送りデータを確認できませんでした");
    this.name = "SupabaseEntryMappingError";
  }
}

function mappingError(): never {
  throw new SupabaseEntryMappingError();
}

function requiredString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : mappingError();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : mappingError();
}

function memberRole(value: unknown): MemberRole {
  if (value === "family" || value === "relative" || value === "helper") {
    return value;
  }
  return mappingError();
}

function entryStatus(value: unknown): EntryStatus {
  if (value === "confirmed" || value === "claimed" || value === "done") {
    return value;
  }
  return mappingError();
}

function neededItemStatus(value: unknown): NeededItemStatus {
  if (
    value === "needed" ||
    value === "purchase_intent" ||
    value === "purchased"
  ) {
    return value;
  }
  return mappingError();
}

function mapMember(row: SupabaseMemberRow): MemberSummary {
  if (!row || typeof row !== "object") return mappingError();

  return {
    id: requiredString(row.id),
    displayName: requiredString(row.display_name),
    role: memberRole(row.role),
  };
}

function mapOptionalMember(
  row: SupabaseMemberRow | null,
): MemberSummary | undefined {
  return row === null ? undefined : mapMember(row);
}

function mapNeededItem(row: SupabaseNeededItemRow): NeededItem {
  if (!row || typeof row !== "object") return mappingError();

  const claimedBy = mapOptionalMember(row.claimed_by);
  return {
    id: requiredString(row.id),
    name: requiredString(row.name),
    status: neededItemStatus(row.status),
    ...(claimedBy ? { claimedBy } : {}),
    updatedAt: requiredString(row.updated_at),
  };
}

export function mapSupabaseEntryRow(
  row: SupabaseEntryRow,
  signedPhotoUrl: string,
): HandoffEntry {
  if (!row || typeof row !== "object" || !Array.isArray(row.needed_items)) {
    return mappingError();
  }

  const actionBy = mapOptionalMember(row.claimed_by);
  return {
    id: requiredString(row.id),
    householdId: requiredString(row.household_id),
    author: mapMember(row.author),
    photoUrl: requiredString(signedPhotoUrl),
    photoAlt: requiredString(row.photo_alt),
    conditionSummary: requiredString(row.condition_summary),
    completedSummary: stringValue(row.completed_summary),
    nextRequest: stringValue(row.next_request),
    status: entryStatus(row.status),
    ...(actionBy ? { actionBy } : {}),
    neededItems: row.needed_items.map(mapNeededItem),
    createdAt: requiredString(row.created_at),
  };
}
