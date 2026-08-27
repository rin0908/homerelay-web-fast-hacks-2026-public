import type { HandoffRelayContext } from "@/lib/relay/types";

export const DEMO_FAMILY_CONTEXT: HandoffRelayContext = {
  householdId: "synthetic-demo-household",
  member: {
    displayName: "デモ家族 あおい",
    id: "demo-family-aoi",
    role: "family",
  },
};

export const DEMO_HELPER_CONTEXT: HandoffRelayContext = {
  householdId: "synthetic-demo-household",
  member: {
    displayName: "デモヘルパー さくら",
    id: "demo-helper-sakura",
    role: "helper",
  },
};
