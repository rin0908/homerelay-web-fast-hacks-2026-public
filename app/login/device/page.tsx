import { notFound } from "next/navigation";

import { DeviceLoginClient } from "@/app/login/device/DeviceLoginClient";

export default function DeviceLoginPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV !== "preview"
  ) {
    notFound();
  }

  return (
    <DeviceLoginClient
      expectedRole="helper"
      heading="iPhoneの合成テストログイン"
    />
  );
}
