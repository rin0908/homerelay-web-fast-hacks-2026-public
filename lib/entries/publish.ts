import { z } from "zod";

// Keep the complete multipart request below common 4.5 MiB serverless limits.
export const MAX_PHOTO_BYTES = Math.floor(3.5 * 1024 * 1024);
export const MAX_PUBLISH_BODY_BYTES = 4 * 1024 * 1024;

const publishFieldsSchema = z
  .object({
    completedSummary: z.string().max(500),
    conditionSummary: z.string().max(500),
    idempotencyKey: z.uuid(),
    neededItems: z
      .array(z.string().trim().min(1).max(120))
      .max(10)
      .refine(
        (items) =>
          new Set(items.map((item) => item.toLocaleLowerCase("ja-JP"))).size ===
          items.length,
        "duplicate item",
      ),
    nextRequest: z.string().max(500),
    photoAlt: z.string().trim().min(1).max(160),
  })
  .refine(
    ({ completedSummary, conditionSummary, nextRequest }) =>
      [completedSummary, conditionSummary, nextRequest].some(
        (value) => value.trim().length > 0,
      ),
    "summary required",
  );

export type PublishFields = z.infer<typeof publishFieldsSchema>;

export type ValidatedPhoto = {
  extension: "jpg" | "png" | "webp";
  file: File;
};

function parseNeededItems(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function parsePublishFields(formData: FormData): PublishFields | null {
  const result = publishFieldsSchema.safeParse({
    completedSummary: formData.get("completedSummary"),
    conditionSummary: formData.get("conditionSummary"),
    idempotencyKey: formData.get("idempotencyKey"),
    neededItems: parseNeededItems(formData.get("neededItems")),
    nextRequest: formData.get("nextRequest"),
    photoAlt: formData.get("photoAlt"),
  });

  if (!result.success) return null;
  return {
    ...result.data,
    completedSummary: result.data.completedSummary.trim(),
    conditionSummary: result.data.conditionSummary.trim(),
    nextRequest: result.data.nextRequest.trim(),
  };
}

function matches(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

export async function validatePhoto(value: FormDataEntryValue | null): Promise<ValidatedPhoto | null> {
  if (!(value instanceof File) || value.size < 12 || value.size > MAX_PHOTO_BYTES) {
    return null;
  }

  const mimeType = value.type.toLowerCase();
  const bytes = new Uint8Array(await value.slice(0, 12).arrayBuffer());

  if (mimeType === "image/jpeg" && matches(bytes, [0xff, 0xd8, 0xff])) {
    return { extension: "jpg", file: value };
  }
  if (
    mimeType === "image/png" &&
    matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return { extension: "png", file: value };
  }
  if (
    mimeType === "image/webp" &&
    matches(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    matches(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return { extension: "webp", file: value };
  }

  return null;
}
