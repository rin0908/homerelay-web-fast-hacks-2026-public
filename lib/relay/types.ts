import type { HandoffEntry, MemberSummary } from "@/types/handoff";

export type RelayMode = "demo" | "supabase";
export type UuidString = `${string}-${string}-${string}-${string}-${string}`;

export type PublishHandoffInput = {
  idempotencyKey: UuidString;
  photo: Blob;
  photoAlt: string;
  conditionSummary: string;
  completedSummary: string;
  nextRequest: string;
  neededItems: string[];
};

export type HandoffRelaySubscriber = (entries: HandoffEntry[]) => void;
export type HandoffRelayUnsubscribe = () => void;

export type HandoffRelayContext = {
  householdId: string;
  member: MemberSummary;
};

export interface HandoffRelay {
  readonly mode: RelayMode;
  list(): Promise<HandoffEntry[]>;
  publish(input: PublishHandoffInput): Promise<string>;
  subscribe(callback: HandoffRelaySubscriber): HandoffRelayUnsubscribe;
  acknowledge(entryId: string): Promise<void>;
  claimEntry(entryId: string): Promise<void>;
  completeEntry(entryId: string): Promise<void>;
  claimItem(itemId: string): Promise<void>;
  completeItem(itemId: string): Promise<void>;
}
