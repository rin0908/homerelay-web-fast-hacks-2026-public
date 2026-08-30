import http from "node:http";
import path from "node:path";
import nextServerModule from "next/dist/server/lib/start-server.js";

const { startServer } = nextServerModule;
const port = Number.parseInt(process.argv[2] ?? "3100", 10);
const controlPort = port + 100;
const shutdownPath = "/__homerelay_playwright_shutdown__";
const liveE2e = process.env.HOMERELAY_E2E_LIVE === "true";

// Playwright validates HomeRelay itself. Vendor connections have dedicated verifiers.
process.env.HOMERELAY_E2E_ISOLATE_VENDORS = "true";
process.env.HOMERELAY_OPENAI_VERIFY = "false";

if (!liveE2e) {
  // Synthetic E2E must remain offline even if a developer has live values in .env.local.
  process.env.HOMERELAY_DEMO_MODE = "true";
  process.env.HOMERELAY_DATA_MODE = "demo";
}

if (!Number.isInteger(port) || port < 1 || port > 65_435) {
  throw new Error("Playwright web server port is invalid.");
}

const controlServer = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== shutdownPath) {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(204).end();
  controlServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});

controlServer.listen(controlPort, "127.0.0.1");

process.env.__NEXT_DEV_SERVER = "1";
process.env.NEXT_PRIVATE_START_TIME = Date.now().toString();

await startServer({
  dir: path.resolve(process.cwd()),
  port,
  allowRetry: false,
  isDev: true,
  hostname: "127.0.0.1",
});
