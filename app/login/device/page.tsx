import { DeviceLoginClient } from "@/app/login/device/DeviceLoginClient";
import { assertDeviceLoginAvailable } from "@/lib/device-login-gate";

export default function DeviceLoginPage() {
  assertDeviceLoginAvailable();

  return (
    <DeviceLoginClient
      expectedRole="helper"
      heading="iPhoneの合成テストログイン"
    />
  );
}
