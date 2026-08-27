import "server-only";

import { after } from "next/server";

import { createQdrantAdapter } from "@/lib/qdrant/adapter";
import { getQdrantConfig } from "@/lib/qdrant/env";
import type { ConfirmedEntryForIndex } from "@/lib/qdrant/types";

/**
 * Registers best-effort Qdrant indexing after a confirmed Supabase response.
 * The result never changes whether the handoff itself was shared successfully.
 */
export function scheduleConfirmedEntryIndex(
  input: ConfirmedEntryForIndex,
): boolean {
  const config = getQdrantConfig();
  if (!config) return false;

  try {
    const adapter = createQdrantAdapter({ config });
    after(async () => {
      await adapter.indexConfirmedEntry(input);
    });
    return true;
  } catch {
    return false;
  }
}
