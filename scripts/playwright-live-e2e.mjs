export const PLAYWRIGHT_LIVE_E2E_PROJECT = "desktop-1280";

export function isPlaywrightLiveE2EEnabled(environment = process.env) {
  return environment.HOMERELAY_E2E_LIVE?.trim().toLowerCase() === "true";
}

export function shouldRunPlaywrightLiveE2EProject(
  liveEnabled,
  projectName,
) {
  return liveEnabled && projectName === PLAYWRIGHT_LIVE_E2E_PROJECT;
}
