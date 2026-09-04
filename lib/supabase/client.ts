import { createBrowserClient } from "@supabase/ssr";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { createSupabaseAbortingFetch } from "@/lib/supabase/aborting-fetch";
import { SUPABASE_BROWSER_AUTH_OPTIONS } from "@/lib/supabase/browser-auth-lock";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

let browserClient: SupabaseClient | null = null;

export function createClient(): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  browserClient ??= createBrowserClient(config.url, config.publishableKey, {
    auth: {
      ...SUPABASE_BROWSER_AUTH_OPTIONS,
      detectSessionInUrl: false,
    },
    global: { fetch: createSupabaseAbortingFetch() },
  });
  return browserClient;
}

export function createEphemeralClient(): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  // Device links are verified away from the cookie-backed application client.
  // A rejected or timed-out verification can therefore never overwrite or
  // remove a session established by another tab or a normal login.
  return createSupabaseClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: createSupabaseAbortingFetch() },
  });
}

export function createTransferClient(): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  // Keep the cookie-backed transfer isolated from the application singleton.
  // Device-login cleanup can dispose its listeners without disturbing the
  // feed's auth subscribers, while a successful setSession still reaches the
  // server-readable HomeRelay cookie store.
  return createBrowserClient(config.url, config.publishableKey, {
    auth: {
      ...SUPABASE_BROWSER_AUTH_OPTIONS,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      skipAutoInitialize: true,
    },
    global: { fetch: createSupabaseAbortingFetch() },
    isSingleton: false,
  });
}
