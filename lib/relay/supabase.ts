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
const DEFAULT_ACTION_BATCH_MS = 650;
const DEFAULT_ACTION_TIMEOUT_MS = 15_000;
const MAX_ACTION_BATCH_SIZE = 10;
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
  actionBatchMs?: number;
  actionTimeoutMs?: number;
  fetch?: RelayFetch;
  photoBucket?: string;
  signedUrlSeconds?: number;
  debounceMs?: number;
  onSubscriptionError?: (error: SupabaseRelayError) => void;
};

type GuardedActionName =
  | "acknowledge_entry"
  | "claim_entry"
  | "complete_entry"
  | "claim_needed_item"
  | "complete_needed_item";

type PendingGuardedAction = {
  action: GuardedActionName;
  reject: (error: SupabaseRelayError) => void;
  resolve: () => void;
  targetId: string;
};

function completedActionCount(payload: unknown, batchSize: number): number {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("completedCount" in payload) ||
    !Number.isInteger(payload.completedCount) ||
    Number(payload.completedCount) < 0 ||
    Number(payload.completedCount) > batchSize
  ) {
    return 0;
  }

  return Number(payload.completedCount);
}

async function readCompletedActionCount(
  response: Response,
  batchSize: number,
): Promise<number> {
  // A malformed but fully received payload means the server did not attest to
  // any completed prefix, so zero is the conservative explicit result. A body
  // read failure is different: the server may already have committed actions
  // before the connection was lost. Let that transport error escape so the
  // relay enters its outcome-uncertain state and blocks dependent transitions.
  return completedActionCount(await response.json(), batchSize);
}

async function runActionRequestWithTimeout<T>(
  fetchImpl: RelayFetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  readResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      fetchImpl(input, { ...init, signal: controller.signal }).then(readResponse),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new SupabaseRelayError("ACTION_FAILED"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  readonly #actionBatchMs: number;
  readonly #actionTimeoutMs: number;
  readonly #onSubscriptionError?: (error: SupabaseRelayError) => void;
  #actionBatchTimer: ReturnType<typeof setTimeout> | null = null;
  #actionFlushChain: Promise<void> = Promise.resolve();
  #actionOutcomeGeneration = 0;
  #actionOutcomeUncertain = false;
  #pendingActions: PendingGuardedAction[] = [];

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
    this.#actionBatchMs = options.actionBatchMs ?? DEFAULT_ACTION_BATCH_MS;
    this.#actionTimeoutMs =
      options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
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

      const entries = await Promise.all(
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
      // A successful authoritative read is the recovery boundary after an
      // uncertain action response. Every guarded RPC is an atomic,
      // state-checked transition (and same-member retries are idempotent), so
      // a retry after this read can only succeed/no-op or be rejected by the
      // current Supabase state; it cannot skip a transition.
      this.#actionOutcomeUncertain = false;
      return entries;
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

    const flushPendingActions = () => {
      if (this.#pendingActions.length === 0) return;
      if (this.#actionBatchTimer) clearTimeout(this.#actionBatchTimer);
      this.#actionBatchTimer = null;
      void this.#flushGuardedActions();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushPendingActions();
    };
    window.addEventListener("pagehide", flushPendingActions);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      clearInterval(signedUrlRefresh);
      window.removeEventListener("pagehide", flushPendingActions);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      void this.#client.removeChannel(channel as RealtimeChannel);
    };
  }

  async acknowledge(entryId: string): Promise<void> {
    await this.#guardedAction("acknowledge_entry", entryId);
  }

  async claimEntry(entryId: string): Promise<void> {
    await this.#guardedAction("claim_entry", entryId);
  }

  async completeEntry(entryId: string): Promise<void> {
    await this.#guardedAction("complete_entry", entryId);
  }

  async claimItem(itemId: string): Promise<void> {
    await this.#guardedAction("claim_needed_item", itemId);
  }

  async completeItem(itemId: string): Promise<void> {
    await this.#guardedAction("complete_needed_item", itemId);
  }

  async #guardedAction(
    name: GuardedActionName,
    targetId: string,
  ): Promise<void> {
    if (this.#actionOutcomeUncertain) {
      throw new SupabaseRelayError("ACTION_FAILED");
    }
    return new Promise<void>((resolve, reject) => {
      this.#pendingActions.push({ action: name, reject, resolve, targetId });
      if (this.#actionBatchTimer) clearTimeout(this.#actionBatchTimer);
      const flushImmediately =
        name === "complete_needed_item" ||
        this.#pendingActions.length >= MAX_ACTION_BATCH_SIZE;
      this.#actionBatchTimer = setTimeout(
        () => void this.#flushGuardedActions(),
        flushImmediately ? 0 : this.#actionBatchMs,
      );
    });
  }

  #markActionOutcomeUncertain(error: SupabaseRelayError): void {
    if (!this.#actionOutcomeUncertain) {
      this.#actionOutcomeGeneration += 1;
    }
    this.#actionOutcomeUncertain = true;
    if (this.#actionBatchTimer) clearTimeout(this.#actionBatchTimer);
    this.#actionBatchTimer = null;

    // These actions have not yet been spliced into a serialized batch. Once a
    // prior request has an unknown server-side outcome, none may be sent, and
    // every caller must be settled immediately rather than left pending until
    // another timer or user interaction happens.
    const unsent = this.#pendingActions.splice(0);
    unsent.forEach(({ reject }) => reject(error));
  }

  async #flushGuardedActions(): Promise<void> {
    this.#actionBatchTimer = null;
    const pending = this.#pendingActions.splice(0, MAX_ACTION_BATCH_SIZE);
    if (pending.length === 0) return;
    const batchGeneration = this.#actionOutcomeGeneration;

    const send = async () => {
      // A prior transport timeout has an unknown server-side outcome. Never
      // send a dependent transition from this relay instance after that point;
      // the caller must reload the authoritative Supabase state first.
      // The generation check also rejects batches already captured by the
      // serialized flush chain before the failure. A later successful list()
      // may recover newly requested actions, but it must not revive old work.
      if (
        this.#actionOutcomeUncertain ||
        batchGeneration !== this.#actionOutcomeGeneration
      ) {
        const relayError = new SupabaseRelayError("ACTION_FAILED");
        pending.forEach(({ reject }) => reject(relayError));
        return;
      }
      try {
        const result = await runActionRequestWithTimeout(
          this.#fetch,
          "/api/actions",
          {
            body: JSON.stringify({
              actions: pending.map(({ action, targetId }) => ({ action, targetId })),
            }),
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            method: "POST",
          },
          this.#actionTimeoutMs,
          async (response) => {
            if (response.ok) return { ok: true } as const;
            return {
              completedCount: await readCompletedActionCount(
                response,
                pending.length,
              ),
              ok: false,
            } as const;
          },
        );
        if (!result.ok) {
          pending
            .slice(0, result.completedCount)
            .forEach(({ resolve }) => resolve());
          const relayError = new SupabaseRelayError("ACTION_FAILED");
          pending
            .slice(result.completedCount)
            .forEach(({ reject }) => reject(relayError));
          return;
        }
        pending.forEach(({ resolve }) => resolve());
      } catch (error) {
        const relayError =
          error instanceof SupabaseRelayError
            ? error
            : new SupabaseRelayError("ACTION_FAILED");
        this.#markActionOutcomeUncertain(relayError);
        pending.forEach(({ reject }) => reject(relayError));
      }
    };

    const queued = this.#actionFlushChain.then(send, send);
    this.#actionFlushChain = queued;
    await queued;

    if (
      !this.#actionOutcomeUncertain &&
      this.#pendingActions.length > 0 &&
      !this.#actionBatchTimer
    ) {
      this.#actionBatchTimer = setTimeout(
        () => void this.#flushGuardedActions(),
        this.#actionBatchMs,
      );
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
