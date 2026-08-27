import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  createQdrantClient,
  type QdrantClientLike,
} from "@/lib/qdrant/client";
import { getQdrantConfig, type QdrantConfig } from "@/lib/qdrant/env";
import {
  MAX_RELATED_RESULTS,
  type ConfirmedEntryForIndex,
  type QdrantIndexResult,
  type QdrantPointType,
  type QdrantRelatedResult,
  type RelatedEntryQuery,
  type RelatedEntryResult,
} from "@/lib/qdrant/types";

const DNS_NAMESPACE = Uint8Array.from([
  0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0,
  0x4f, 0xd4, 0x30, 0xc8,
]);

const pointTypeSchema = z.enum(["handoff", "needed_item"]);

const confirmedEntrySchema = z
  .strictObject({
    completedSummary: z.string().trim().max(500),
    conditionSummary: z.string().trim().max(500),
    createdAt: z.iso.datetime({ offset: true }),
    entryId: z.uuid(),
    householdId: z.uuid(),
    neededItems: z.array(z.string().trim().min(1).max(120)).max(10),
    nextRequest: z.string().trim().max(500),
  })
  .refine(
    ({ completedSummary, conditionSummary, nextRequest }) =>
      Boolean(completedSummary || conditionSummary || nextRequest),
    "confirmed summary required",
  )
  .refine(
    ({ neededItems }) =>
      new Set(neededItems.map(normalizeDiscriminator)).size === neededItems.length,
    "duplicate needed item",
  );

const relatedQuerySchema = z.strictObject({
  currentEntryId: z.uuid(),
  householdId: z.uuid(),
  queryText: z.string().trim().min(1).max(2_000),
  type: pointTypeSchema,
});

const payloadSchema = z.strictObject({
  created_at: z.iso.datetime({ offset: true }),
  display_text: z.string().trim().min(1).max(500),
  entry_id: z.uuid(),
  household_id: z.uuid(),
  type: pointTypeSchema,
});

const scoredPointSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    payload: payloadSchema,
    score: z.number().finite(),
  })
  .passthrough();

const queryResponseSchema = z
  .object({ points: z.array(z.unknown()) })
  .passthrough();

export type QdrantAdapterOptions = Readonly<{
  client?: QdrantClientLike | null;
  config?: QdrantConfig | null;
}>;

function normalizeDiscriminator(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function deterministicQdrantPointId(
  type: QdrantPointType,
  entryId: string,
  discriminator = "",
): string {
  const name = [
    "homerelay",
    "qdrant",
    "v1",
    type,
    entryId.toLowerCase(),
    normalizeDiscriminator(discriminator),
  ].join(":");
  const digest = createHash("sha1")
    .update(DNS_NAMESPACE)
    .update(name, "utf8")
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));

  // RFC 9562 UUIDv5: SHA-1 supplies stable, non-secret identifiers only.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function truncate(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class HomeRelayQdrantAdapter {
  readonly #client: QdrantClientLike | null;
  readonly #config: QdrantConfig | null;

  constructor(options: QdrantAdapterOptions = {}) {
    this.#config = hasOwn(options, "config")
      ? (options.config ?? null)
      : getQdrantConfig();
    this.#client = hasOwn(options, "client")
      ? (options.client ?? null)
      : createQdrantClient(this.#config);
  }

  async indexConfirmedEntry(
    input: ConfirmedEntryForIndex,
  ): Promise<QdrantIndexResult> {
    if (!this.#config || !this.#client) {
      return {
        pointCount: 0,
        reason: "not_configured",
        status: "unavailable",
      };
    }

    const parsed = confirmedEntrySchema.safeParse(input);
    if (!parsed.success) {
      return {
        pointCount: 0,
        reason: "invalid_input",
        status: "unavailable",
      };
    }

    const entry = parsed.data;
    const summaryParts = [
      entry.conditionSummary,
      entry.completedSummary,
      entry.nextRequest,
    ].filter(Boolean);
    const summaryText = summaryParts.join("\n");
    const summaryDisplayText = truncate(summaryParts.join(" / "), 500);
    const model = this.#config.embeddingModel;
    const sharedPayload = {
      created_at: entry.createdAt,
      entry_id: entry.entryId,
      household_id: entry.householdId,
    };
    const points = [
      {
        id: deterministicQdrantPointId("handoff", entry.entryId),
        payload: {
          ...sharedPayload,
          display_text: summaryDisplayText,
          type: "handoff" as const,
        },
        vector: { model, text: summaryText },
      },
      ...entry.neededItems.map((item) => ({
        id: deterministicQdrantPointId("needed_item", entry.entryId, item),
        payload: {
          ...sharedPayload,
          display_text: item,
          type: "needed_item" as const,
        },
        vector: { model, text: item },
      })),
    ];

    try {
      await this.#client.upsert(this.#config.collection, {
        points,
        timeout: Math.max(1, Math.ceil(this.#config.timeoutMs / 1_000)),
        wait: true,
      });
      return { pointCount: points.length, status: "indexed" };
    } catch {
      return {
        pointCount: 0,
        reason: "unavailable",
        status: "unavailable",
      };
    }
  }

  async findRelated(input: RelatedEntryQuery): Promise<QdrantRelatedResult> {
    if (!this.#config || !this.#client) {
      return {
        items: [],
        reason: "not_configured",
        status: "unavailable",
      };
    }

    const parsed = relatedQuerySchema.safeParse(input);
    if (!parsed.success) {
      return {
        items: [],
        reason: "invalid_input",
        status: "unavailable",
      };
    }

    const query = parsed.data;
    let response: unknown;
    try {
      response = await this.#client.query(this.#config.collection, {
        filter: {
          must: [
            {
              key: "household_id",
              match: { value: query.householdId },
            },
            { key: "type", match: { value: query.type } },
          ],
          must_not: [
            {
              key: "entry_id",
              match: { value: query.currentEntryId },
            },
          ],
        },
        limit: MAX_RELATED_RESULTS,
        query: {
          model: this.#config.embeddingModel,
          text: query.queryText,
        },
        timeout: Math.max(1, Math.ceil(this.#config.timeoutMs / 1_000)),
        with_payload: [
          "household_id",
          "entry_id",
          "type",
          "created_at",
          "display_text",
        ],
        with_vector: false,
      });
    } catch {
      return {
        items: [],
        reason: "unavailable",
        status: "unavailable",
      };
    }

    const parsedResponse = queryResponseSchema.safeParse(response);
    if (!parsedResponse.success) {
      return {
        items: [],
        reason: "invalid_response",
        status: "unavailable",
      };
    }

    const items: RelatedEntryResult[] = [];
    for (const candidate of parsedResponse.data.points) {
      const point = scoredPointSchema.safeParse(candidate);
      if (!point.success) continue;

      const payload = point.data.payload;
      if (
        payload.household_id !== query.householdId ||
        payload.entry_id === query.currentEntryId ||
        payload.type !== query.type
      ) {
        continue;
      }

      items.push({
        createdAt: payload.created_at,
        displayText: payload.display_text,
        entryId: payload.entry_id,
        pointId: point.data.id,
        score: point.data.score,
        type: payload.type,
      });
      if (items.length === MAX_RELATED_RESULTS) break;
    }

    return { items, status: "available" };
  }
}

export function createQdrantAdapter(
  options?: QdrantAdapterOptions,
): HomeRelayQdrantAdapter {
  return new HomeRelayQdrantAdapter(options);
}
