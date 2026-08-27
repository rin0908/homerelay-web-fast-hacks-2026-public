import { describe, expect, it } from "vitest";

import {
  MAX_PHOTO_BYTES,
  parsePublishFields,
  validatePhoto,
} from "@/lib/entries/publish";

function validFormData() {
  const formData = new FormData();
  formData.set("idempotencyKey", "10000000-0000-4000-8000-000000000001");
  formData.set("conditionSummary", " 合成デモの様子 ");
  formData.set("completedSummary", "");
  formData.set("nextRequest", " 次の方へ ");
  formData.set("photoAlt", "合成デモで撮影した申し送り写真");
  formData.set("neededItems", JSON.stringify(["ティッシュ"]));
  return formData;
}

describe("parsePublishFields", () => {
  it("accepts, trims, and limits a synthetic confirmed handoff", () => {
    expect(parsePublishFields(validFormData())).toEqual({
      completedSummary: "",
      conditionSummary: "合成デモの様子",
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
      neededItems: ["ティッシュ"],
      nextRequest: "次の方へ",
      photoAlt: "合成デモで撮影した申し送り写真",
    });
  });

  it("rejects an empty summary, malformed idempotency key, and duplicate items", () => {
    const empty = validFormData();
    empty.set("conditionSummary", " ");
    empty.set("nextRequest", "");
    expect(parsePublishFields(empty)).toBeNull();

    const malformed = validFormData();
    malformed.set("idempotencyKey", "not-a-uuid");
    expect(parsePublishFields(malformed)).toBeNull();

    const duplicate = validFormData();
    duplicate.set("neededItems", JSON.stringify(["ティッシュ", "ティッシュ"]));
    expect(parsePublishFields(duplicate)).toBeNull();
  });
});

describe("validatePhoto", () => {
  it("accepts only supported MIME types with matching file signatures", async () => {
    const jpeg = new File(
      [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0xff])],
      "synthetic.jpg",
      { type: "image/jpeg" },
    );
    const disguised = new File(
      [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0xff])],
      "synthetic.png",
      { type: "image/png" },
    );

    await expect(validatePhoto(jpeg)).resolves.toMatchObject({ extension: "jpg" });
    await expect(validatePhoto(disguised)).resolves.toBeNull();
  });

  it("rejects empty and oversized images before upload", async () => {
    const empty = new File([], "empty.jpg", { type: "image/jpeg" });
    const oversized = new File(
      [new Uint8Array(MAX_PHOTO_BYTES + 1)],
      "large.jpg",
      { type: "image/jpeg" },
    );

    await expect(validatePhoto(empty)).resolves.toBeNull();
    await expect(validatePhoto(oversized)).resolves.toBeNull();
  });
});
