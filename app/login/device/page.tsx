import { DeviceLoginClient } from "@/app/login/device/DeviceLoginClient";
import {
  assertDeviceLoginAvailable,
  redirectAuthenticatedDeviceLogin,
} from "@/lib/device-login-gate";

export default async function DeviceLoginPage() {
  assertDeviceLoginAvailable();
  await redirectAuthenticatedDeviceLogin();

  return (
    <DeviceLoginClient
      expectedRole="helper"
      heading="iPhoneの合成テストログイン"
    />
  );
}
