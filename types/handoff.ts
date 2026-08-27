export type MemberRole = "family" | "relative" | "helper";

export type MemberSummary = {
  id: string;
  displayName: string;
  role: MemberRole;
};

export type EntryStatus = "confirmed" | "claimed" | "done";
export type NeededItemStatus = "needed" | "purchase_intent" | "purchased";

export type NeededItem = {
  id: string;
  name: string;
  status: NeededItemStatus;
  claimedBy?: MemberSummary;
  updatedAt: string;
};

export type HandoffEntry = {
  id: string;
  householdId: string;
  author: MemberSummary;
  photoUrl: string;
  photoAlt: string;
  conditionSummary: string;
  completedSummary: string;
  nextRequest: string;
  status: EntryStatus;
  actionBy?: MemberSummary;
  neededItems: NeededItem[];
  createdAt: string;
};
