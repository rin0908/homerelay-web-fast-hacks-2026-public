# Datadog optional integration

## Purpose

HomeRelay sends only three numeric custom metrics from server Route Handlers:

- `homerelay.api.duration_ms`
- `homerelay.ai.duration_ms`
- `homerelay.api.error_count`

Runtime metric tags are limited to `service`, `env`, `route`, `outcome`, and the
AI mode (`openai` or `synthetic`). The dedicated verifier adds only fixed
`source`, `data_class`, and `verification_marker` tags. Photos, audio, names,
handoff text, item text, IDs, URLs, exception messages, and stack traces are
never metric values or tags.

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
request. It also refuses network access outside explicit Supabase live mode or
while vendor isolation is enabled. With a HomeRelay-only key, it submits fixed
synthetic success/failure counters and one numeric duration point. Every point
has the non-user marker
`verification_marker:homerelay-datadog-live-v1`; use that exact tag in Metrics
Explorer for the manual UI read-back. HTTP 202 proves intake acceptance, but the
tagged points must still be seen in the Datadog organization before calling the
dashboard live. The verifier never reads or prints a vendor response body,
exception detail, API key, handoff content, or household/user identifier.

## Current live status (2026-08-30)

Datadog is **not live-connected and not used**. AP1 Japan registration was
attempted with two different email addresses, and both verification-code
send/resend flows returned Datadog's `Unknown error` / 「不明なエラー」. No API
key was created or saved, and no metric ingestion or UI read-back was run. Do
not repeat the same registration flow; after all other completion work, make at
most one final retry and record its result without converting adapter or unit
test evidence into a live-use claim.

Official references:

- [Submit metrics](https://docs.datadoghq.com/api/latest/metrics/submit-metrics/)
- [Datadog sites](https://docs.datadoghq.com/getting_started/site/)
- [Graphing with JSON](https://docs.datadoghq.com/dashboards/guide/graphing_json/)
