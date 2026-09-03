import "server-only";

import { notFound, redirect } from "next/navigation";

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
  if (await getCurrentSession()) {
    // A QR must never replace an already authenticated member. Sending that
    // browser straight home also avoids presenting the protected 409 as a
    // failed login while leaving the one-time token unconsumed.
    redirect("/");
  }
}
