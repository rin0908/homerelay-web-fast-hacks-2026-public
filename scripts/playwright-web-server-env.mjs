import { isPlaywrightLiveE2EEnabled } from "./playwright-live-e2e.mjs";

export function configurePlaywrightWebServerEnvironment(
  environment = process.env,
) {
  const liveE2e = isPlaywrightLiveE2EEnabled(environment);

  // The ordinary Playwright suite must never inherit live vendor credentials.
  environment.HOMERELAY_E2E_ISOLATE_VENDORS = "true";
  environment.HOMERELAY_OPENAI_VERIFY = "false";

  if (!liveE2e) {
    environment.HOMERELAY_DEMO_MODE = "true";
    environment.HOMERELAY_DATA_MODE = "demo";
  }
}
