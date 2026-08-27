export type SupabaseEnvironment = {
  HOMERELAY_DEMO_MODE?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

export type SupabasePublicConfig = Readonly<{
  publishableKey: string;
  url: string;
}>;

function currentEnvironment(): SupabaseEnvironment {
  return {
    HOMERELAY_DEMO_MODE: process.env.HOMERELAY_DEMO_MODE,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getSupabasePublicConfig(
  environment: SupabaseEnvironment = currentEnvironment(),
): SupabasePublicConfig | null {
  if (environment.HOMERELAY_DEMO_MODE?.trim().toLowerCase() === "true") {
    return null;
  }

  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey =
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

  if (!url || !publishableKey || !validHttpUrl(url)) {
    return null;
  }

  return { publishableKey, url };
}

export function isSupabaseConfigured(
  environment?: SupabaseEnvironment,
): boolean {
  return getSupabasePublicConfig(environment) !== null;
}
