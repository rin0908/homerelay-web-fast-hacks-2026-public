import { describe, expect, it } from "vitest";

import {
  getSupabasePublicConfig,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

const configured = {
  HOMERELAY_DEMO_MODE: "false",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
};

describe("Supabase environment", () => {
  it("returns no configuration in explicit demo mode", () => {
    expect(
      getSupabasePublicConfig({
        ...configured,
        HOMERELAY_DEMO_MODE: " TRUE ",
      }),
    ).toBeNull();
  });

  it.each([
    [{ ...configured, NEXT_PUBLIC_SUPABASE_URL: "" }],
    [{ ...configured, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }],
    [{ ...configured, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }],
    [{ ...configured, NEXT_PUBLIC_SUPABASE_URL: "javascript:alert(1)" }],
  ])("returns no configuration for incomplete or invalid public values", (environment) => {
    expect(getSupabasePublicConfig(environment)).toBeNull();
    expect(isSupabaseConfigured(environment)).toBe(false);
  });

  it("returns only trimmed browser-safe values when configured", () => {
    const result = getSupabasePublicConfig({
      ...configured,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "  sb_publishable_synthetic  ",
      NEXT_PUBLIC_SUPABASE_URL: "  https://synthetic.supabase.co  ",
    });

    expect(result).toEqual({
      publishableKey: "sb_publishable_synthetic",
      url: "https://synthetic.supabase.co",
    });
    expect(result).not.toHaveProperty("secretKey");
    expect(isSupabaseConfigured(configured)).toBe(true);
  });
});
