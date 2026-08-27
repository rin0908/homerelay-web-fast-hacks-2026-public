export const SYNTHETIC_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";

export const SYNTHETIC_MEMBERS = {
  helper: {
    id: "00000000-0000-4000-8000-000000000101",
    displayName: "デモヘルパー さくら",
    role: "helper" as const,
  },
  family: {
    id: "00000000-0000-4000-8000-000000000102",
    displayName: "デモ家族 あおい",
    role: "family" as const,
  },
  relative: {
    id: "00000000-0000-4000-8000-000000000103",
    displayName: "デモ親族 ひなた",
    role: "relative" as const,
  },
} as const;

export const SYNTHETIC_DRAFT = {
  conditionSummary: "昼食は半分ほど召し上がりました",
  completedSummary: "水分を用意しました",
  nextRequest: "次に訪れた方は水分をご確認ください",
  neededItems: ["トイレットペーパー"],
} as const;

export const SYNTHETIC_ENTRIES: HandoffEntry[] = [
  {
    id: "00000000-0000-4000-8000-000000001001",
    householdId: SYNTHETIC_HOUSEHOLD_ID,
    author: SYNTHETIC_MEMBERS.helper,
    photoUrl: "/demo/synthetic-meal.png",
    photoAlt: "合成デモ用の、半分ほど食べた昼食",
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "次に訪れた方は水分をご確認ください",
    status: "confirmed",
    neededItems: [
      {
        id: "00000000-0000-4000-8000-000000002001",
        name: "トイレットペーパー",
        status: "needed",
        updatedAt: "2026-08-27T03:04:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000002002",
        name: "麦茶",
        status: "purchase_intent",
        claimedBy: SYNTHETIC_MEMBERS.family,
        updatedAt: "2026-08-27T03:06:00.000Z",
      },
    ],
    createdAt: "2026-08-27T03:03:00.000Z",
  },
];
import type { HandoffEntry } from "@/types/handoff";
