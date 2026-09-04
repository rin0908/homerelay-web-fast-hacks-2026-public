import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  acquireOpenAIRequestSlot,
  resetOpenAIRequestGuardForTests,
} from "@/lib/ai/request-guard";

const MEMBER_A = "10000000-0000-4000-8000-000000000001";
const MEMBER_B = "10000000-0000-4000-8000-000000000002";
const HOUSEHOLD = "20000000-0000-4000-8000-000000000001";

describe("OpenAI request guard", () => {
  beforeEach(() => resetOpenAIRequestGuardForTests());

  it("permits one active request per member and releases idempotently", () => {
    const first = acquireOpenAIRequestSlot({
      householdId: HOUSEHOLD,
      memberId: MEMBER_A,
      now: 1_000,
    });
    expect(first.status).toBe("allowed");
    expect(
      acquireOpenAIRequestSlot({
        householdId: HOUSEHOLD,
        memberId: MEMBER_A,
        now: 1_001,
      }),
    ).toMatchObject({ status: "busy" });

    if (first.status === "allowed") {
      first.release();
      first.release();
    }
    const second = acquireOpenAIRequestSlot({
      householdId: HOUSEHOLD,
      memberId: MEMBER_A,
      now: 1_002,
    });
    expect(second.status).toBe("allowed");
  });

  it("limits each member to three attempts per ten-minute window", () => {
    for (let index = 0; index < 3; index += 1) {
      const slot = acquireOpenAIRequestSlot({
        householdId: HOUSEHOLD,
        memberId: MEMBER_A,
        now: 10_000 + index,
      });
      expect(slot.status).toBe("allowed");
      if (slot.status === "allowed") slot.release();
    }

    expect(
      acquireOpenAIRequestSlot({
        householdId: HOUSEHOLD,
        memberId: MEMBER_A,
        now: 10_100,
      }),
    ).toMatchObject({ status: "rate_limited" });

    expect(
      acquireOpenAIRequestSlot({
        householdId: HOUSEHOLD,
        memberId: MEMBER_A,
        now: 10_000 + 10 * 60 * 1_000 + 1,
      }),
    ).toMatchObject({ status: "allowed" });
  });

  it("limits concurrent work across one household", () => {
    const first = acquireOpenAIRequestSlot({
      householdId: HOUSEHOLD,
      memberId: MEMBER_A,
      now: 1_000,
    });
    const second = acquireOpenAIRequestSlot({
      householdId: HOUSEHOLD,
      memberId: MEMBER_B,
      now: 1_001,
    });
    expect(first.status).toBe("allowed");
    expect(second.status).toBe("allowed");
    expect(
      acquireOpenAIRequestSlot({
        householdId: HOUSEHOLD,
        memberId: "10000000-0000-4000-8000-000000000003",
        now: 1_002,
      }),
    ).toMatchObject({ status: "busy" });
  });

  it("rejects unsafe subject keys", () => {
    expect(
      acquireOpenAIRequestSlot({
        householdId: HOUSEHOLD,
        memberId: "bad\nmember",
      }),
    ).toMatchObject({ status: "rate_limited" });
    expect(
      acquireOpenAIRequestSlot({
        householdId: "bad\nhousehold",
        memberId: MEMBER_A,
      }),
    ).toMatchObject({ status: "rate_limited" });
  });
});
