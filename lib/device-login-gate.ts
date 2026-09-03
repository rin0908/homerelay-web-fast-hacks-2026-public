import "server-only";

import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolveCurrentSession } from "@/lib/supabase/session";

export function assertDeviceLoginAvailable(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV !== "preview"
  ) {
    notFound();
  }
}

export async function redirectAuthenticatedDeviceLogin(): Promise<void> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    notFound();
  }
  if (!supabase) notFound();

  let resolution: Awaited<ReturnType<typeof resolveCurrentSession>>;
  try {
    resolution = await resolveCurrentSession(supabase);
  } catch {
    notFound();
  }
  if (resolution.state === "unauthenticated") return;
  if (resolution.state !== "verified") notFound();

  // A QR must never replace an already authenticated member. Sending that
  // browser straight home also avoids presenting the protected 409 as a
  // failed login while leaving the one-time token unconsumed.
  redirect("/");
}
