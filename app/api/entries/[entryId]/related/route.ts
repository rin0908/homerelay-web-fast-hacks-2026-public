import { NextResponse } from "next/server";

import { withApiMetrics } from "@/lib/datadog/instrumentation";
import { getIntegrationStatus } from "@/lib/integration-status";
import { createQdrantAdapter } from "@/lib/qdrant/adapter";
import {
  MAX_RELATED_RESULTS,
  type QdrantRelatedResult,
  type RelatedEntryResult,
} from "@/lib/qdrant/types";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/supabase/session";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ITEM_QUERIES = 5;

type NeededItemRow = {
  id: string;
  name: string;
  status: "needed" | "purchase_intent" | "purchased";
};

type RelatedEntryRow = {
  completed_summary: string;
  condition_summary: string;
  created_at: string;
  household_id: string;
  id: string;
  needed_items: NeededItemRow[];
  next_request: string;
};

type SimilarHandoffDto = {
  createdAt: string;
  entryId: string;
  score: number;
  summary: string;
};

type DuplicateItemDto = {
  candidateItemName: string;
  createdAt: string;
  currentItemName: string;
  entryId: string;
  score: number;
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function textValue(value: unknown): value is string {
  return typeof value === "string";
}

function isNeededItemRow(value: unknown): value is NeededItemRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    requiredString(row.id) &&
    requiredString(row.name) &&
    (row.status === "needed" ||
      row.status === "purchase_intent" ||
      row.status === "purchased")
  );
}

function parseEntryRow(value: unknown): RelatedEntryRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    !requiredString(row.id) ||
    !requiredString(row.household_id) ||
    !requiredString(row.condition_summary) ||
    !textValue(row.completed_summary) ||
    !textValue(row.next_request) ||
    !requiredString(row.created_at) ||
    !Array.isArray(row.needed_items) ||
    !row.needed_items.every(isNeededItemRow)
  ) {
    return null;
  }

  return {
    completed_summary: row.completed_summary,
    condition_summary: row.condition_summary,
    created_at: row.created_at,
    household_id: row.household_id,
    id: row.id,
    needed_items: row.needed_items,
    next_request: row.next_request,
  };
}

function normalizedItemName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
}

function handoffText(entry: RelatedEntryRow): string {
  return [
    entry.condition_summary,
    entry.completed_summary,
    entry.next_request,
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("。")
    .slice(0, 1_500);
}

function uniqueResults(results: readonly RelatedEntryResult[]) {
  const byEntry = new Map<string, RelatedEntryResult>();
  for (const result of results) {
    const current = byEntry.get(result.entryId);
    if (!current || result.score > current.score) {
      byEntry.set(result.entryId, result);
    }
  }
  return [...byEntry.values()];
}

function available(result: QdrantRelatedResult): boolean {
  return result.status === "available";
}

async function getRelated(
  _request: Request,
  context: { params: Promise<{ entryId: string }> },
) {
  if (getIntegrationStatus().dataMode !== "supabase") {
    return jsonError("Supabase本番モードが設定されていません", 503);
  }

  const { entryId } = await context.params;
  if (!UUID_PATTERN.test(entryId)) {
    return jsonError("申し送りIDを確認してください", 400);
  }

  const supabase = await createClient();
  if (!supabase) return jsonError("Supabaseへ接続できません", 503);

  const session = await getCurrentSession(supabase);
  if (!session) return jsonError("ログインが必要です", 401);

  const { data: currentData, error: currentError } = await supabase
    .from("entries")
    .select(
      "id, household_id, condition_summary, completed_summary, next_request, created_at, needed_items(id, name, status)",
    )
    .eq("id", entryId)
    .maybeSingle();
  const currentEntry = parseEntryRow(currentData);

  if (
    currentError ||
    !currentEntry ||
    currentEntry.household_id !== session.member.householdId
  ) {
    return jsonError("申し送りが見つかりません", 404);
  }

  const adapter = createQdrantAdapter();
  const itemQueries = currentEntry.needed_items
    .filter((item) => item.status !== "purchased")
    .slice(0, MAX_ITEM_QUERIES);
  const [handoffResult, ...itemResults] = await Promise.all([
    adapter.findRelated({
      currentEntryId: currentEntry.id,
      householdId: session.member.householdId,
      queryText: handoffText(currentEntry),
      type: "handoff",
    }),
    ...itemQueries.map((item) =>
      adapter.findRelated({
        currentEntryId: currentEntry.id,
        householdId: session.member.householdId,
        queryText: item.name,
        type: "needed_item",
      }),
    ),
  ]);

  const qdrantAvailable = [handoffResult, ...itemResults].some(available);
  const qdrantCandidates = [
    ...(handoffResult.status === "available" ? handoffResult.items : []),
    ...itemResults.flatMap((result) =>
      result.status === "available" ? result.items : [],
    ),
  ];
  const candidateIds = [
    ...new Set(
      qdrantCandidates
        .map((candidate) => candidate.entryId)
        .filter((candidateId) =>
          UUID_PATTERN.test(candidateId) && candidateId !== currentEntry.id,
        ),
    ),
  ];

  if (candidateIds.length === 0) {
    return NextResponse.json(
      {
        mode: qdrantAvailable ? "qdrant" : "unavailable",
        similarHandoffs: [],
        duplicateItems: [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data: candidateData, error: candidateError } = await supabase
    .from("entries")
    .select(
      "id, household_id, condition_summary, completed_summary, next_request, created_at, needed_items(id, name, status)",
    )
    .in("id", candidateIds);

  if (candidateError || !Array.isArray(candidateData)) {
    return jsonError("関連候補を確認できませんでした", 502);
  }

  const candidates = new Map<string, RelatedEntryRow>();
  for (const value of candidateData) {
    const candidate = parseEntryRow(value);
    if (
      candidate &&
      candidate.id !== currentEntry.id &&
      candidate.household_id === session.member.householdId
    ) {
      candidates.set(candidate.id, candidate);
    }
  }

  const similarHandoffs: SimilarHandoffDto[] = uniqueResults(
    handoffResult.status === "available"
      ? handoffResult.items.filter((item) => item.type === "handoff")
      : [],
  )
    .flatMap((result) => {
      const candidate = candidates.get(result.entryId);
      return candidate
        ? [
            {
              createdAt: candidate.created_at,
              entryId: candidate.id,
              score: result.score,
              summary: handoffText(candidate),
            },
          ]
        : [];
    })
    .slice(0, MAX_RELATED_RESULTS);

  const duplicateItems: DuplicateItemDto[] = [];
  const duplicateKeys = new Set<string>();
  for (const [index, result] of itemResults.entries()) {
    if (result.status !== "available") continue;
    const currentItem = itemQueries[index];
    for (const related of result.items) {
      if (related.type !== "needed_item") continue;
      const candidate = candidates.get(related.entryId);
      if (!candidate) continue;
      const candidateItem = candidate.needed_items.find(
        (item) =>
          item.status !== "purchased" &&
          normalizedItemName(item.name) ===
            normalizedItemName(related.displayText),
      );
      if (!candidateItem) continue;

      const key = `${currentItem.id}:${candidate.id}:${candidateItem.id}`;
      if (duplicateKeys.has(key)) continue;
      duplicateKeys.add(key);
      duplicateItems.push({
        candidateItemName: candidateItem.name,
        createdAt: candidate.created_at,
        currentItemName: currentItem.name,
        entryId: candidate.id,
        score: related.score,
      });
    }
  }
  duplicateItems.sort((left, right) => right.score - left.score);

  return NextResponse.json(
    {
      mode: qdrantAvailable ? "qdrant" : "unavailable",
      similarHandoffs,
      duplicateItems: duplicateItems.slice(0, MAX_RELATED_RESULTS),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = withApiMetrics("related", getRelated);
