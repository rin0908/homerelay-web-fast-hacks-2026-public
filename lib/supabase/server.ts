import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { createSupabaseAbortingFetch } from "@/lib/supabase/aborting-fetch";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

export async function createClient(): Promise<SupabaseClient | null> {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    global: { fetch: createSupabaseAbortingFetch() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The root Proxy refreshes
          // the session and writes the same cookies to its response.
        }
      },
    },
  });
}
