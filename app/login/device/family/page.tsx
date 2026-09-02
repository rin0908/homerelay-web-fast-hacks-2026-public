import { DeviceLoginClient } from "@/app/login/device/DeviceLoginClient";
import { assertDeviceLoginAvailable } from "@/lib/device-login-gate";

export default function FamilyDeviceLoginPage() {
  assertDeviceLoginAvailable();

  return (
    <DeviceLoginClient
      expectedRole="family"
      heading="Windowsの合成テストログイン"
    />
  );
}
