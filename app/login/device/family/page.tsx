import { notFound } from "next/navigation";

import { DeviceLoginClient } from "@/app/login/device/DeviceLoginClient";

export default function FamilyDeviceLoginPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV !== "preview"
  ) {
    notFound();
  }

  return (
    <DeviceLoginClient
      expectedRole="family"
      heading="Windowsの合成テストログイン"
    />
  );
}
