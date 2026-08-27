import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "@/lib/supabase/env";

let browserClient: SupabaseClient | null = null;

export function createClient(): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  browserClient ??= createBrowserClient(config.url, config.publishableKey);
  return browserClient;
}
