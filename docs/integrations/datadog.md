# Datadog optional integration

## Purpose

HomeRelay sends only three numeric custom metrics from server Route Handlers:

- `homerelay.api.duration_ms`
- `homerelay.ai.duration_ms`
- `homerelay.api.error_count`

The fixed tags are limited to `service`, `env`, `route`, `outcome`, and the AI
mode (`openai` or `synthetic`). Photos, audio, names, handoff text, item text,
IDs, URLs, exception messages, and stack traces are never metric values or tags.

Metric submission is registered with Next.js `after()` after the application
response is known. Missing credentials, timeouts, and Datadog errors cannot
change an API response.

## Server-only configuration

```dotenv
HOMERELAY_DEMO_MODE=false
HOMERELAY_DATA_MODE=supabase
DD_SITE=datadoghq.com
DD_API_KEY=
DATADOG_TIMEOUT_MS=1500
```

`DD_SITE` is checked against Datadog's documented site list. Do not add an
application key unless dashboard creation/read-back is deliberately automated;
metric submission needs only the API key.

## Dashboard template

`docs/integrations/datadog-dashboard.json` contains three widgets for API
duration by route, AI duration by real/synthetic mode, and API error count. It is
an import template, not evidence that a Datadog dashboard has been created.

## Verification

```powershell
npm run verify:datadog
```

Without `DD_API_KEY`, the verifier exits successfully with `SKIP` and makes no
request. With a HomeRelay-only key, it submits one synthetic numeric duration
point. A successful API response proves ingestion acceptance; dashboard display
must still be checked in the Datadog organization before calling the dashboard
live.

Official references:

- [Submit metrics](https://docs.datadoghq.com/api/latest/metrics/submit-metrics/)
- [Datadog sites](https://docs.datadoghq.com/getting_started/site/)
- [Graphing with JSON](https://docs.datadoghq.com/dashboards/guide/graphing_json/)
