export const PLAYWRIGHT_LIVE_E2E_PROJECT: "desktop-1280";

export function isPlaywrightLiveE2EEnabled(
  environment?: Record<string, string | undefined>,
): boolean;

export function shouldRunPlaywrightLiveE2EProject(
  liveEnabled: boolean,
  projectName: string,
): boolean;
