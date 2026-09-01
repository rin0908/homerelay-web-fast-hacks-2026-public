import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiMetrics } from "@/lib/datadog/instrumentation";
import { readBoundedRequest } from "@/lib/http/bounded-request";
import { getIntegrationStatus } from "@/lib/integration-status";
import {
  scheduleHandoffActionGraphSync,
  schedulePurchaseActionGraphSync,
} from "@/lib/neo4j/sync";
import type { HandoffAction, PurchaseAction } from "@/lib/neo4j/types";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/supabase/session";

export const runtime = "nodejs";

const MAX_ACTION_BODY_BYTES = 4_096;
const MAX_ACTIONS_PER_REQUEST = 10;

const actionSchema = z
  .object({
    action: z.enum([
      "acknowledge_entry",
      "claim_entry",
      "complete_entry",
      "claim_needed_item",
      "complete_needed_item",
    ]),
    targetId: z.uuid(),
  })
  .strict();

const actionRequestSchema = z.union([
  actionSchema.transform((action) => [action]),
  z
    .object({
      actions: z.array(actionSchema).min(1).max(MAX_ACTIONS_PER_REQUEST),
    })
    .strict()
    .transform(({ actions }) => actions),
]);

type ActionInput = z.infer<typeof actionSchema>;
type ParsedAction =
  | Readonly<{ inputs: ActionInput[]; status: "ok" }>
  | Readonly<{ status: "malformed" | "too_large" }>;
type EntryActionName =
  | "acknowledge_entry"
  | "claim_entry"
  | "complete_entry";

const ENTRY_GRAPH_ACTION: Record<EntryActionName, HandoffAction> = {
  acknowledge_entry: "confirmed",
  claim_entry: "claimed",
  complete_entry: "done",
};

const PURCHASE_GRAPH_ACTION = {
  claim_needed_item: "purchase_intent",
  complete_needed_item: "purchased",
} as const satisfies Record<
  Exclude<ActionInput["action"], EntryActionName>,
  PurchaseAction
>;

function isEntryAction(action: ActionInput["action"]): action is EntryActionName {
  return action in ENTRY_GRAPH_ACTION;
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function databaseErrorStatus(error: { code?: string }) {
  if (error.code === "42501") return 403;
  if (error.code === "P0001") return 409;
  if (error.code === "22023") return 400;
  return 502;
}

async function parseAction(request: Request): Promise<ParsedAction> {
  const bounded = await readBoundedRequest(request, MAX_ACTION_BODY_BYTES);
  if (bounded.status !== "ok") return bounded;

  try {
    const result = actionRequestSchema.safeParse(await bounded.request.json());
    return result.success
      ? { inputs: result.data, status: "ok" }
      : { status: "malformed" };
  } catch {
    return { status: "malformed" };
  }
}

async function postAction(request: Request) {
  const integration = getIntegrationStatus();
  if (integration.dataMode !== "supabase") {
    return jsonError("Supabase本番モードが設定されていません", 503);
  }

  const parsed = await parseAction(request);
  if (parsed.status !== "ok") {
    return jsonError(
      "操作内容を確認してください",
      parsed.status === "too_large" ? 413 : 400,
    );
  }
  const { inputs } = parsed;

  const supabase = await createClient();
  if (!supabase) return jsonError("Supabaseへ接続できません", 503);

  const session = await getCurrentSession(supabase);
  if (!session) return jsonError("ログインが必要です", 401);

  const itemGraphActions = new Map<
    string,
    Array<{ action: PurchaseAction; occurredAt: string }>
  >();
  for (const input of inputs) {
    const graphAction = isEntryAction(input.action)
      ? ENTRY_GRAPH_ACTION[input.action]
      : null;
    const parameterName = graphAction ? "p_entry_id" : "p_item_id";
    const { error } = await supabase.rpc(input.action, {
      [parameterName]: input.targetId,
    });
    if (error) {
      return jsonError(
        "操作を完了できませんでした",
        databaseErrorStatus(error),
      );
    }

    if (!integration.neo4j.active) continue;
    if (isEntryAction(input.action)) {
      try {
        scheduleHandoffActionGraphSync({
          action: ENTRY_GRAPH_ACTION[input.action],
          entryId: input.targetId,
          householdId: session.member.householdId,
          memberId: session.member.id,
          memberRole: session.member.role,
          occurredAt: new Date().toISOString(),
        });
      } catch {
        // Optional graph projection can never change the successful RPC result.
      }
    } else {
      const actions = itemGraphActions.get(input.targetId) ?? [];
      actions.push({
        action: PURCHASE_GRAPH_ACTION[input.action],
        occurredAt: new Date().toISOString(),
      });
      itemGraphActions.set(input.targetId, actions);
    }
  }

  if (integration.neo4j.active) {
    for (const [itemId, actions] of itemGraphActions) {
      try {
        const { data: item, error: itemError } = await supabase
          .from("needed_items")
          .select("id, entry_id, household_id, status")
          .eq("id", itemId)
          .maybeSingle();
        const expectedStatus = actions.at(-1)?.action;

        if (
          !itemError &&
          item &&
          item.id === itemId &&
          typeof item.entry_id === "string" &&
          item.household_id === session.member.householdId &&
          expectedStatus &&
          item.status === expectedStatus
        ) {
          for (const action of actions) {
            schedulePurchaseActionGraphSync({
              action: action.action,
              entryId: item.entry_id,
              householdId: session.member.householdId,
              itemId,
              memberId: session.member.id,
              memberRole: session.member.role,
              occurredAt: action.occurredAt,
            });
          }
        }
      } catch {
        // Optional graph projection can never change the successful RPC result.
      }
    }
  }

  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

export const POST = withApiMetrics("actions", postAction);
