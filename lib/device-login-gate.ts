import "server-only";

import { notFound } from "next/navigation";

export function assertDeviceLoginAvailable(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV !== "preview"
  ) {
    notFound();
  }
}
