import { describe, expect, it, vi } from "vitest";
import {
  mapSupabaseEntryRow,
  SupabaseEntryMappingError,
  type SupabaseEntryRow,
} from "@/lib/relay/supabase-mapper";

function row(): SupabaseEntryRow {
  return {
    id: "entry-1",
    household_id: "household-1",
    author: {
      id: "helper-1",
      display_name: "デモヘルパー さくら",
      role: "helper",
    },
    claimed_by: {
      id: "family-1",
      display_name: "デモ家族 あおい",
      role: "family",
    },
    photo_path: "household-1/entry-1/photo.jpg",
    photo_alt: "架空の昼食の写真",
    condition_summary: "昼食は半分ほど召し上がりました",
    completed_summary: "水分を用意しました",
    next_request: "夕方に水分をご確認ください",
    status: "claimed",
    needed_items: [
      {
        id: "item-1",
        name: "トイレットペーパー",
        status: "purchase_intent",
        claimed_by: {
          id: "relative-1",
          display_name: "デモ親族 ひなた",
          role: "relative",
        },
        updated_at: "2026-08-27T10:00:00.000Z",
      },
    ],
    created_at: "2026-08-27T09:00:00.000Z",
  };
}

describe("mapSupabaseEntryRow", () => {
  it("maps nested members and needed items using the signed photo URL", () => {
    const source = row();
    const signedPhotoUrl =
      "https://synthetic.supabase.co/storage/v1/object/sign/handoff/photo.jpg?token=test";

    expect(mapSupabaseEntryRow(source, signedPhotoUrl)).toEqual({
      id: "entry-1",
      householdId: "household-1",
      author: {
        id: "helper-1",
        displayName: "デモヘルパー さくら",
        role: "helper",
      },
      photoUrl: signedPhotoUrl,
      photoAlt: "架空の昼食の写真",
      conditionSummary: "昼食は半分ほど召し上がりました",
      completedSummary: "水分を用意しました",
      nextRequest: "夕方に水分をご確認ください",
      status: "claimed",
      actionBy: {
        id: "family-1",
        displayName: "デモ家族 あおい",
        role: "family",
      },
      neededItems: [
        {
          id: "item-1",
          name: "トイレットペーパー",
          status: "purchase_intent",
          claimedBy: {
            id: "relative-1",
            displayName: "デモ親族 ひなた",
            role: "relative",
          },
          updatedAt: "2026-08-27T10:00:00.000Z",
        },
      ],
      createdAt: "2026-08-27T09:00:00.000Z",
    });
  });

  it("omits optional assignees when the nested relationships are null", () => {
    const source = row();
    source.claimed_by = null;
    source.needed_items[0]!.claimed_by = null;

    const mapped = mapSupabaseEntryRow(source, "https://example.test/signed-photo");

    expect(mapped).not.toHaveProperty("actionBy");
    expect(mapped.neededItems[0]).not.toHaveProperty("claimedBy");
  });

  it("preserves valid empty optional summaries", () => {
    const source = row();
    source.completed_summary = "";
    source.next_request = "";

    expect(mapSupabaseEntryRow(source, "https://example.test/signed-photo")).toMatchObject({
      completedSummary: "",
      nextRequest: "",
    });
  });

  it.each([
    ["author role", (source: SupabaseEntryRow) => (source.author.role = "owner")],
    ["entry status", (source: SupabaseEntryRow) => (source.status = "draft")],
    [
      "entry assignee role",
      (source: SupabaseEntryRow) => (source.claimed_by!.role = "manager"),
    ],
    [
      "needed item status",
      (source: SupabaseEntryRow) => (source.needed_items[0]!.status = "ordered"),
    ],
    [
      "needed item assignee role",
      (source: SupabaseEntryRow) =>
        (source.needed_items[0]!.claimed_by!.role = "guest"),
    ],
  ])("rejects an unsupported %s without logging row content", (_label, mutate) => {
    const source = row();
    mutate(source);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      mapSupabaseEntryRow(source, "https://example.test/signed-photo"),
    ).toThrow(SupabaseEntryMappingError);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("uses a fixed safe error that does not expose rejected input", () => {
    const source = row();
    source.author.display_name = "sensitive-synthetic-marker";
    source.author.role = "invalid-sensitive-role";

    try {
      mapSupabaseEntryRow(source, "https://example.test/signed-photo");
      throw new Error("Expected mapping to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SupabaseEntryMappingError);
      expect(error).toMatchObject({ code: "INVALID_SUPABASE_ENTRY" });
      expect((error as Error).message).not.toContain("sensitive-synthetic-marker");
      expect((error as Error).message).not.toContain("invalid-sensitive-role");
    }
  });

  it("rejects an empty signed URL instead of exposing a private path", () => {
    expect(() => mapSupabaseEntryRow(row(), "")).toThrow(
      SupabaseEntryMappingError,
    );
  });
});
