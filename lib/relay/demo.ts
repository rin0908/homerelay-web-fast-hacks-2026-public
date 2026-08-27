import {
  publishDemoEntry,
  readDemoEntries,
  subscribeDemoEntries,
  writeDemoEntries,
} from "@/lib/demo-relay";
import type {
  HandoffRelay,
  HandoffRelayContext,
  HandoffRelaySubscriber,
  HandoffRelayUnsubscribe,
  PublishHandoffInput,
} from "@/lib/relay/types";
import type { HandoffEntry } from "@/types/handoff";

export type DemoRelayOptions = {
  now?: () => string;
  encodePhoto?: (photo: Blob) => Promise<string>;
};

function blobToDataUrl(photo: Blob): Promise<string> {
  if (typeof FileReader !== "function") {
    return Promise.reject(new Error("デモ写真を準備できませんでした"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("デモ写真を準備できませんでした"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(photo);
  });
}

export class DemoRelay implements HandoffRelay {
  readonly mode = "demo" as const;

  readonly #context: HandoffRelayContext;
  readonly #encodePhoto: (photo: Blob) => Promise<string>;
  readonly #now: () => string;

  constructor(context: HandoffRelayContext, options: DemoRelayOptions = {}) {
    this.#context = context;
    this.#encodePhoto = options.encodePhoto ?? blobToDataUrl;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async list(): Promise<HandoffEntry[]> {
    return readDemoEntries();
  }

  async publish(input: PublishHandoffInput): Promise<string> {
    const existing = readDemoEntries().find(
      (entry) => entry.id === input.idempotencyKey,
    );
    if (existing) return existing.id;

    const createdAt = this.#now();
    publishDemoEntry({
      id: input.idempotencyKey,
      author: this.#context.member,
      householdId: this.#context.householdId,
      photoUrl: await this.#encodePhoto(input.photo),
      photoAlt: input.photoAlt,
      conditionSummary: input.conditionSummary,
      completedSummary: input.completedSummary,
      nextRequest: input.nextRequest,
      status: "confirmed",
      neededItems: input.neededItems.map((name, index) => ({
        id: `${input.idempotencyKey}-item-${index}`,
        name,
        status: "needed",
        updatedAt: createdAt,
      })),
      createdAt,
    });
    return input.idempotencyKey;
  }

  subscribe(callback: HandoffRelaySubscriber): HandoffRelayUnsubscribe {
    return subscribeDemoEntries(callback);
  }

  async acknowledge(entryId: string): Promise<void> {
    this.#updateEntries((entry) =>
      entry.id === entryId && entry.status === "confirmed"
        ? { ...entry, actionBy: this.#context.member }
        : entry,
    );
  }

  async claimEntry(entryId: string): Promise<void> {
    this.#updateEntries((entry) =>
      entry.id === entryId && entry.status === "confirmed"
        ? { ...entry, actionBy: this.#context.member, status: "claimed" }
        : entry,
    );
  }

  async completeEntry(entryId: string): Promise<void> {
    this.#updateEntries((entry) =>
      entry.id === entryId &&
      entry.status === "claimed" &&
      entry.actionBy?.id === this.#context.member.id
        ? { ...entry, status: "done" }
        : entry,
    );
  }

  async claimItem(itemId: string): Promise<void> {
    this.#updateEntries((entry) =>
      ({
        ...entry,
        neededItems: entry.neededItems.map((item) =>
          item.id === itemId && item.status === "needed"
            ? {
                ...item,
                claimedBy: this.#context.member,
                status: "purchase_intent" as const,
                updatedAt: this.#now(),
              }
            : item,
        ),
      }),
    );
  }

  async completeItem(itemId: string): Promise<void> {
    this.#updateEntries((entry) =>
      ({
        ...entry,
        neededItems: entry.neededItems.map((item) =>
          item.id === itemId &&
          item.status === "purchase_intent" &&
          item.claimedBy?.id === this.#context.member.id
            ? {
                ...item,
                status: "purchased" as const,
                updatedAt: this.#now(),
              }
            : item,
        ),
      }),
    );
  }

  #updateEntries(update: (entry: HandoffEntry) => HandoffEntry): void {
    writeDemoEntries(readDemoEntries().map(update));
  }
}

export function createDemoRelay(
  context: HandoffRelayContext,
  options?: DemoRelayOptions,
): HandoffRelay {
  return new DemoRelay(context, options);
}
