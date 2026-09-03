import "server-only";

import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/supabase/session";

export function assertDeviceLoginAvailable(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV !== "preview"
  ) {
    notFound();
  }
}

export async function redirectAuthenticatedDeviceLogin(): Promise<void> {
  const supabase = await createClient();
  if (!supabase) notFound();

  let claims: Awaited<ReturnType<typeof supabase.auth.getClaims>>;
  try {
    claims = await supabase.auth.getClaims();
  } catch {
    notFound();
  }
  if (claims.error) notFound();
  if (!claims.data) return;

  // Verified Auth claims must resolve to a valid member before this route can
  // decide that the browser is unauthenticated. A provider or membership read
  // failure therefore cannot expose a token-consuming login client.
  if (!(await getCurrentSession(supabase))) notFound();

  // A QR must never replace an already authenticated member. Sending that
  // browser straight home also avoids presenting the protected 409 as a
  // failed login while leaving the one-time token unconsumed.
  redirect("/");
}
