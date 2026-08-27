const liveE2e = process.env.HOMERELAY_E2E_LIVE === "true";
const controlPort = (liveE2e ? 3101 : 3100) + 100;

export default async function globalTeardown() {
  try {
    await fetch(
      `http://127.0.0.1:${controlPort}/__homerelay_playwright_shutdown__`,
      {
        method: "POST",
        signal: AbortSignal.timeout(2_000),
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch {
    // A reused server has no HomeRelay test-control listener and needs no cleanup.
  }
}
