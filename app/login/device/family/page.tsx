import { DeviceLoginClient } from "@/app/login/device/DeviceLoginClient";
import {
  assertDeviceLoginAvailable,
  redirectAuthenticatedDeviceLogin,
} from "@/lib/device-login-gate";

export default async function FamilyDeviceLoginPage() {
  assertDeviceLoginAvailable();
  await redirectAuthenticatedDeviceLogin();

  return (
    <DeviceLoginClient
      expectedRole="family"
      heading="Windowsの合成テストログイン"
    />
  );
}
