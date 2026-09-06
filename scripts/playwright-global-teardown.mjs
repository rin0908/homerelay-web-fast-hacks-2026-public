function resolveControlPort(config) {
  try {
    const url = new URL(config.webServer.url);
    const serverPort = Number.parseInt(url.port, 10);
    if (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      Number.isInteger(serverPort) &&
      serverPort > 0 &&
      serverPort <= 65_435
    ) {
      return serverPort + 100;
    }
  } catch {
    // The fallback ports below remain loopback-only.
  }
  return null;
}

export default async function globalTeardown(config) {
  // The resolved Playwright config is the source of truth for the server port.
  // This avoids loading sibling ESM through Playwright's teardown transformer.
  const configuredPort = resolveControlPort(config);
  const controlPorts = configuredPort ? [configuredPort] : [3200, 3201];

  await Promise.all(
    controlPorts.map(async (controlPort) => {
      try {
        await fetch(
          `http://127.0.0.1:${controlPort}/__homerelay_playwright_shutdown__`,
          {
            method: "POST",
            signal: AbortSignal.timeout(2_000),
          },
        );
      } catch {
        // A missing test-control listener needs no cleanup.
      }
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
}
