import { describe, expect, it } from "vitest";

import {
  applyConfirmedEntryAction,
  applyConfirmedItemAction,
} from "@/lib/relay/confirmed-transitions";
import { SYNTHETIC_ENTRIES, SYNTHETIC_MEMBERS } from "@/lib/synthetic-data";

describe("confirmed relay transitions", () => {
  it("updates an entry only after the caller has confirmed the server action", () => {
    const source = structuredClone(SYNTHETIC_ENTRIES);
    const updated = applyConfirmedEntryAction(
      source,
      source[0]!.id,
      "claimed",
      SYNTHETIC_MEMBERS.family,
    );

    expect(updated).not.toBe(source);
    expect(updated[0]).toMatchObject({
      actionBy: SYNTHETIC_MEMBERS.family,
      status: "claimed",
    });
    expect(source[0]!.status).toBe("confirmed");
  });

  it("updates only the selected needed item", () => {
    const source = structuredClone(SYNTHETIC_ENTRIES);
    const itemId = source[0]!.neededItems[0]!.id;
    const updated = applyConfirmedItemAction(
      source,
      itemId,
      "purchase_intent",
      SYNTHETIC_MEMBERS.family,
      "2026-09-01T06:00:00.000Z",
    );

    expect(updated[0]!.neededItems[0]).toMatchObject({
      claimedBy: SYNTHETIC_MEMBERS.family,
      status: "purchase_intent",
      updatedAt: "2026-09-01T06:00:00.000Z",
    });
    const untouchedItem = source[0]!.neededItems[1];
    expect(untouchedItem).toBeDefined();
    expect(updated[0]!.neededItems[1]).toEqual(untouchedItem);
  });

  it("preserves the existing array when no target exists", () => {
    const source = structuredClone(SYNTHETIC_ENTRIES);

    expect(
      applyConfirmedEntryAction(
        source,
        "00000000-0000-4000-8000-000000009999",
        "done",
        SYNTHETIC_MEMBERS.family,
      ),
    ).toBe(source);
    expect(
      applyConfirmedItemAction(
        source,
        "00000000-0000-4000-8000-000000009999",
        "purchased",
        SYNTHETIC_MEMBERS.family,
        "2026-09-01T06:00:00.000Z",
      ),
    ).toBe(source);
  });
});
