import { z } from "zod";

const conciseText = z.string().trim().max(160);

export const HandoffDraftSchema = z
  .object({
    conditionSummary: conciseText.min(1),
    completedSummary: conciseText,
    nextRequest: conciseText,
    neededItems: z.array(z.string().trim().min(1).max(50)).max(5),
  })
  .strict();

export type HandoffDraft = z.infer<typeof HandoffDraftSchema>;

export const DraftResultSchema = z
  .object({
    mode: z.enum(["live", "demo"]),
    draft: HandoffDraftSchema,
  })
  .strict();

export type DraftResult = z.infer<typeof DraftResultSchema>;

export const SYNTHETIC_AI_DRAFT: HandoffDraft = {
  conditionSummary: "昼食は半分ほど召し上がりました",
  completedSummary: "水分を用意しました",
  nextRequest: "次に訪れた方は水分をご確認ください",
  neededItems: ["トイレットペーパー"],
};

export function parseHandoffDraftJson(value: string): HandoffDraft {
  return HandoffDraftSchema.parse(JSON.parse(value));
}
