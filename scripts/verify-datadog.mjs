const SITE_ENDPOINTS = {
  "ap1.datadoghq.com": "https://api.ap1.datadoghq.com/api/v2/series",
  "ap2.datadoghq.com": "https://api.ap2.datadoghq.com/api/v2/series",
  "datadoghq.com": "https://api.datadoghq.com/api/v2/series",
  "datadoghq.eu": "https://api.datadoghq.eu/api/v2/series",
  "ddog-gov.com": "https://api.ddog-gov.com/api/v2/series",
  "uk1.datadoghq.com": "https://api.uk1.datadoghq.com/api/v2/series",
  "us2.ddog-gov.com": "https://api.us2.ddog-gov.com/api/v2/series",
  "us3.datadoghq.com": "https://api.us3.datadoghq.com/api/v2/series",
  "us5.datadoghq.com": "https://api.us5.datadoghq.com/api/v2/series",
};

function timeoutMs() {
  const value = process.env.DATADOG_TIMEOUT_MS?.trim();
  if (!value) return 1_500;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 250 && parsed <= 5_000
    ? parsed
    : null;
}

async function verify() {
  const apiKey = process.env.DD_API_KEY?.trim();
  if (!apiKey) {
    console.log("SKIP: DD_API_KEY is not configured.");
    return;
  }
  if (!/^[A-Za-z0-9]{32,64}$/.test(apiKey)) {
    throw new Error("DD_API_KEY has an invalid format.");
  }

  const site =
    process.env.DD_SITE?.trim().toLowerCase() || "datadoghq.com";
  const endpoint = SITE_ENDPOINTS[site];
  const timeout = timeoutMs();
  if (!endpoint) throw new Error("DD_SITE is not supported.");
  if (timeout === null) throw new Error("DATADOG_TIMEOUT_MS is invalid.");

  const response = await fetch(endpoint, {
    body: JSON.stringify({
      series: [
        {
          metric: "homerelay.api.duration_ms",
          points: [
            {
              timestamp: Math.floor(Date.now() / 1_000),
              value: 1,
            },
          ],
          tags: [
            "service:homerelay",
            "env:verification",
            "route:draft",
            "outcome:success",
            "source:synthetic_verifier",
          ],
          type: 3,
        },
      ],
    }),
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "DD-API-KEY": apiKey,
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) throw new Error("Datadog rejected the synthetic metric.");
  console.log("Datadog accepted one synthetic numeric duration metric.");
}

try {
  await verify();
} catch {
  console.error("Datadog verification failed without exposing vendor details.");
  process.exitCode = 1;
}
