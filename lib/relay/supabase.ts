import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  mapSupabaseEntryRow,
  type SupabaseEntryRow,
  type SupabaseMemberRow,
  type SupabaseNeededItemRow,
} from "@/lib/relay/supabase-mapper";
import type {
  HandoffRelay,
  HandoffRelaySubscriber,
  HandoffRelayUnsubscribe,
  PublishHandoffInput,
} from "@/lib/relay/types";
import type { HandoffEntry } from "@/types/handoff";

const ENTRY_SELECT = `
  id,
  household_id,
  photo_path,
  photo_alt,
  condition_summary,
  completed_summary,
  next_request,
  status,
  created_at,
  author:members!entries_author_same_household(id, display_name, role),
  action_by:members!entries_claimed_by_same_household(id, display_name, role),
  needed_items:needed_items!needed_items_entry_same_household(
    id,
    name,
    status,
    updated_at,
    claimed_by:members!needed_items_claimed_by_same_household(id, display_name, role)
  ),
  acknowledgements:acknowledgements!acknowledgements_entry_same_household(
    action,
    created_at,
    member:members!acknowledgements_member_same_household(id, display_name, role)
  )
`;

const DEFAULT_PHOTO_BUCKET = "handoff-photos";
const DEFAULT_SIGNED_URL_SECONDS = 300;
const DEFAULT_DEBOUNCE_MS = 120;
const LIST_LIMIT = 10;
const PRIVATE_PHOTO_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='%23eef1ec'/%3E%3C/svg%3E";

type RelayFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type SupabaseAcknowledgementRow = {
  action: string;
  created_at: string;
  member: SupabaseMemberRow;
};

export type SupabaseListEntryRow = Omit<SupabaseEntryRow, "claimed_by"> & {
  action_by: SupabaseMemberRow | null;
  acknowledgements: SupabaseAcknowledgementRow[];
  needed_items: SupabaseNeededItemRow[];
};

export type SupabaseRelayContext = {
  householdId: string;
};

export type SupabaseRelayOptions = {
  fetch?: RelayFetch;
  photoBucket?: string;
  signedUrlSeconds?: number;
  debounceMs?: number;
  onSubscriptionError?: (error: SupabaseRelayError) => void;
};

export type SupabaseRelayErrorCode =
  | "LIST_FAILED"
  | "PUBLISH_FAILED"
  | "ACTION_FAILED";

export class SupabaseRelayError extends Error {
  constructor(readonly code: SupabaseRelayErrorCode) {
    super("Supabaseの申し送り処理に失敗しました");
    this.name = "SupabaseRelayError";
  }
}

function fail(code: SupabaseRelayErrorCode): never {
  throw new SupabaseRelayError(code);
}

function isAllowedAction(value: unknown): value is "confirmed" | "claimed" | "done" {
  return value === "confirmed" || value === "claimed" || value === "done";
}

function isAllowedRole(value: unknown): value is "family" | "relative" | "helper" {
  return value === "family" || value === "relative" || value === "helper";
}

function acknowledgementMember(row: SupabaseListEntryRow): SupabaseMemberRow | null {
  if (!Array.isArray(row.acknowledgements)) return fail("LIST_FAILED");

  let latest: SupabaseAcknowledgementRow | null = null;
  for (const acknowledgement of row.acknowledgements) {
    if (
      !acknowledgement ||
      typeof acknowledgement !== "object" ||
      !isAllowedAction(acknowledgement.action) ||
      typeof acknowledgement.created_at !== "string" ||
      !acknowledgement.member ||
      !isAllowedRole(acknowledgement.member.role)
    ) {
      return fail("LIST_FAILED");
    }

    if (
      acknowledgement.action === row.status &&
      (!latest || acknowledgement.created_at > latest.created_at)
    ) {
      latest = acknowledgement;
    }
  }

  return latest?.member ?? null;
}

function normalizedMapperRow(row: SupabaseListEntryRow): SupabaseEntryRow {
  return {
    id: row.id,
    household_id: row.household_id,
    author: row.author,
    claimed_by: row.action_by ?? acknowledgementMember(row),
    photo_path: row.photo_path,
    photo_alt: row.photo_alt,
    condition_summary: row.condition_summary,
    completed_summary: row.completed_summary,
    next_request: row.next_request,
    status: row.status,
    needed_items: row.needed_items,
    created_at: row.created_at,
  };
}

export class SupabaseRelay implements HandoffRelay {
  readonly mode = "supabase" as const;

  readonly #client: SupabaseClient;
  readonly #context: SupabaseRelayContext;
  readonly #fetch: RelayFetch;
  readonly #photoBucket: string;
  readonly #signedUrlSeconds: number;
  readonly #debounceMs: number;
  readonly #onSubscriptionError?: (error: SupabaseRelayError) => void;

  constructor(
    client: SupabaseClient,
    context: SupabaseRelayContext,
    options: SupabaseRelayOptions = {},
  ) {
    this.#client = client;
    this.#context = context;
    this.#fetch =
      options.fetch ??
      ((input, init) => globalThis.fetch(input, init));
    this.#photoBucket = options.photoBucket ?? DEFAULT_PHOTO_BUCKET;
    this.#signedUrlSeconds =
      options.signedUrlSeconds ?? DEFAULT_SIGNED_URL_SECONDS;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#onSubscriptionError = options.onSubscriptionError;
  }

  async list(): Promise<HandoffEntry[]> {
    try {
      const { data, error } = await this.#client
        .from("entries")
        .select(ENTRY_SELECT)
        .eq("household_id", this.#context.householdId)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);

      if (error || !Array.isArray(data)) return fail("LIST_FAILED");

      return await Promise.all(
        data.map(async (value) => {
          const row = value as unknown as SupabaseListEntryRow;
          const { data: signed, error: signedError } = await this.#client.storage
            .from(this.#photoBucket)
            .createSignedUrl(row.photo_path, this.#signedUrlSeconds);

          return mapSupabaseEntryRow(
            normalizedMapperRow(row),
            signedError || !signed?.signedUrl
              ? PRIVATE_PHOTO_PLACEHOLDER
              : signed.signedUrl,
          );
        }),
      );
    } catch (error) {
      if (error instanceof SupabaseRelayError) throw error;
      return fail("LIST_FAILED");
    }
  }

  async publish(input: PublishHandoffInput): Promise<string> {
    const formData = new FormData();
    formData.append("idempotencyKey", input.idempotencyKey);
    formData.append("photo", input.photo, "handoff-photo");
    formData.append("photoAlt", input.photoAlt);
    formData.append("conditionSummary", input.conditionSummary);
    formData.append("completedSummary", input.completedSummary);
    formData.append("nextRequest", input.nextRequest);
    formData.append("neededItems", JSON.stringify(input.neededItems));

    try {
      const response = await this.#fetch("/api/entries", {
        body: formData,
        method: "POST",
      });
      if (!response.ok) return fail("PUBLISH_FAILED");

      const payload: unknown = await response.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        !("entryId" in payload) ||
        typeof payload.entryId !== "string" ||
        payload.entryId.trim().length === 0
      ) {
        return fail("PUBLISH_FAILED");
      }
      return payload.entryId;
    } catch (error) {
      if (error instanceof SupabaseRelayError) throw error;
      return fail("PUBLISH_FAILED");
    }
  }

  subscribe(callback: HandoffRelaySubscriber): HandoffRelayUnsubscribe {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    const signedUrlRefresh = setInterval(
      () => refresh(),
      Math.max(30_000, (this.#signedUrlSeconds - 30) * 1_000),
    );

    const refresh = () => {
      if (!active) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        void this.list().then(
          (entries) => {
            if (active) callback(entries);
          },
          (error: unknown) => {
            if (active && this.#onSubscriptionError) {
              this.#onSubscriptionError(
                error instanceof SupabaseRelayError
                  ? error
                  : new SupabaseRelayError("LIST_FAILED"),
              );
            }
          },
        );
      }, this.#debounceMs);
    };

    const filter = `household_id=eq.${this.#context.householdId}`;
    const channel = this.#client
      .channel(`homerelay-handoffs-${this.#context.householdId}`)
      .on(
        "postgres_changes",
        { event: "*", filter, schema: "public", table: "entries" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", filter, schema: "public", table: "needed_items" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", filter, schema: "public", table: "acknowledgements" },
        refresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
        if (
          active &&
          ["CHANNEL_ERROR", "CLOSED", "TIMED_OUT"].includes(status) &&
          this.#onSubscriptionError
        ) {
          this.#onSubscriptionError(new SupabaseRelayError("LIST_FAILED"));
        }
      });

    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      clearInterval(signedUrlRefresh);
      void this.#client.removeChannel(channel as RealtimeChannel);
    };
  }

  async acknowledge(entryId: string): Promise<void> {
    await this.#guardedRpc("acknowledge_entry", { p_entry_id: entryId });
  }

  async claimEntry(entryId: string): Promise<void> {
    await this.#guardedRpc("claim_entry", { p_entry_id: entryId });
  }

  async completeEntry(entryId: string): Promise<void> {
    await this.#guardedRpc("complete_entry", { p_entry_id: entryId });
  }

  async claimItem(itemId: string): Promise<void> {
    await this.#guardedRpc("claim_needed_item", { p_item_id: itemId });
  }

  async completeItem(itemId: string): Promise<void> {
    await this.#guardedRpc("complete_needed_item", { p_item_id: itemId });
  }

  async #guardedRpc(
    name:
      | "acknowledge_entry"
      | "claim_entry"
      | "complete_entry"
      | "claim_needed_item"
      | "complete_needed_item",
    parameters: { p_entry_id: string } | { p_item_id: string },
  ): Promise<void> {
    try {
      const { error } = await this.#client.rpc(name, parameters);
      if (error) return fail("ACTION_FAILED");
    } catch (error) {
      if (error instanceof SupabaseRelayError) throw error;
      return fail("ACTION_FAILED");
    }
  }
}

export function createSupabaseRelay(
  client: SupabaseClient,
  context: SupabaseRelayContext,
  options?: SupabaseRelayOptions,
): HandoffRelay {
  return new SupabaseRelay(client, context, options);
}
