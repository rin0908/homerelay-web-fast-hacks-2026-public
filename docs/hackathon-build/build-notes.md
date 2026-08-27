# Build Notes

## Handoff decisions

- 2026-08-27: User directed that Codex, not this assistant turn, will implement the application.
- Created a completely independent empty Git repository for HomeRelay.
- CareRelay was not read, changed, copied, or referenced as an implementation source.
- Autonomous speed-run selected because the hackathon build window is short.
- Core demo is protected by a stop rule: no Neo4j, CodeRabbit, or Datadog work before the main flow passes twice.
- Exact needed-item wording was actively shaped by the user: `購入します` and `購入しました`; no refill/delivery wording.
- Visiting nurses were explicitly removed. Shared content is a family-facing handoff summary, not an official provider record.

## Build log

Codex should append one dated entry after every completed checklist item with:

- Files changed
- Verification commands and results
- Live integration or fallback status
- Any checklist adaptation and reason

### 2026-08-27 — Checklist 1 complete: isolation and scaffold

- Files changed: initialized the HomeRelay-local Git repository; added pinned Next.js 16.3.3 / React 19.2.8 / Tailwind 4.3.3 scaffold, TypeScript, ESLint, Vitest, App Router shell, server-only integration status, synthetic fixtures, lockfile, and explicit demo banner. Updated stale HomeRelay working-path text in `WORKFLOW.md`.
- Verification: the working path resolved to the HomeRelay repository root; `npm run lint` passed; `npm run typecheck` passed; `npm run build` passed; dev `GET /` and `GET /api/status` returned 200; status returned demo for OpenAI, Supabase, and Qdrant; `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities.
- Isolation: repository source/config/dependency scan found no implementation or package reference to any external project path. Policy documents retain only the required non-contact boundary wording.
- Live/fallback: `.env.local` and vendor credentials are absent. The app starts in a clearly labeled, synthetic-only demo mode and does not issue vendor requests.
- Adaptation: latest published ESLint 10 and TypeScript 7 exceeded the peer range of the pinned Next.js lint toolchain, so compatible pinned versions ESLint 9.39.5 and TypeScript 6.0.3 were selected. A broken `lucide-react` 1.34.0 publish was replaced with local typed SVG icons after both type and production-build failures.

### 2026-08-27 — Checklist 2 complete: warm responsive shell

- Files changed: added the warm `今日の様子` home feed, photo-first confirmed handoff card, the three allowed role badges, exact action and purchase wording, large labeled controls, responsive record-callout shell, loading/error/not-found states, local typed icons, and a generated synthetic meal photo at `public/demo/synthetic-meal.png`.
- Synthetic image: generated with OpenAI's built-in image generation using an explicitly fictional overhead Japanese lunch scene with no people, names, text, logos, or other personal information. It is demo media only.
- Verification: `npm run lint`, `npm run typecheck`, and `npm run test:run` passed; Playwright + Chrome passed 4/4 checks across 390 px phone and 1280 px desktop layouts; axe found no serious or critical violations after the secondary-text contrast correction; both screenshots were visually inspected; source scan found no pure-black token, forbidden purchase/refill/delivery wording, or visiting-nurse role.
- Live/fallback: the shell uses synthetic fixtures and displays `合成デモモード`; no external service call is made. The generated photo is bundled locally so the UI remains reliable without credentials.
- Adaptation: `agent-browser` was not installed in the workspace, so the equivalent visual and accessibility verification was performed with pinned Playwright against the installed Chrome browser.

### 2026-08-27 — Checklist 3 implementation complete; manual phone check pending

- Files changed: added rear-camera-first `getUserMedia`, in-page preview, capture, retake, accept and cancel states; canvas JPEG re-encoding with a 1600 px long-edge cap; EXIF-removing fresh-canvas export; full MediaStreamTrack cleanup; and an `image/*` fallback shown only when the media API is unavailable.
- Automated verification: camera/image unit tests passed 6/6; the complete unit suite later passed 29/29; Playwright + Chrome synthetic-camera capture, retake, and accept passed at 390 px and 1280 px; production build passed. Visual inspection confirmed the accepted-photo screen.
- Privacy: temporary Object URLs are revoked, active tracks stop on capture/cancel/unmount and stale permission requests, and accepted photos remain client-side at this stage. No gallery-save API is used.
- Pending acceptance check: a real HTTPS smartphone permission/camera-indicator check is still required. This item remains unchecked; the user asked work to continue without interruption, so later checklist implementation proceeds while this hardware-only gate stays explicit.

### 2026-08-27 — Checklist 4 complete: voice recording and human-confirmed AI draft

- Files changed: added an audio-only MediaRecorder flow, permission/retry/cancel states, temporary-audio cleanup, size and MIME guarded `/api/draft` route, server-only OpenAI transcription and structured-output adapter, strict Zod schema, deterministic missing-credential fallback, editable draft form, and a local `これでOK` confirmation boundary.
- Verification: `npm run lint`, `npm run typecheck`, `npm run test:run` (7 files / 29 tests), `npm run test:e2e` (8/8 across phone and desktop), and `npm run build` passed. Route tests covered valid, empty, bad MIME, oversized, missing-key, invalid JSON/schema and safe upstream-error cases; component tests covered audio-only constraints, track cleanup, permission denial, retry, edit and confirmation.
- Privacy and boundary: raw audio and partial transcripts are not logged or returned to the browser; the in-memory Blob is discarded after processing/cancel/failure. Browser verification confirmed that no share endpoint is called before or after `これでOK` at this stage and the UI still says `まだ家族には共有されていません`.
- Live/fallback: `OPENAI_API_KEY` is absent and `HOMERELAY_DEMO_MODE=true`; therefore no OpenAI request was made or claimed. The UI explicitly labels `合成AI下書き（OpenAI未接続）`. The live server adapter and schema validation remain ready for credentials.

### 2026-08-27 — Emergency demo pivot: local two-tab MVP complete

- Scope change: with 20 minutes remaining, the user stopped cloud Supabase/Auth/RLS and all Neo4j, Datadog, CodeRabbit, HackerSquad and new-credential work. The app was deliberately narrowed to a synthetic, same-browser demo.
- Files changed: added a HomeRelay-specific localStorage store with BroadcastChannel plus `storage` event fan-out, confirmed-entry publication only after `次の人へ`, live family-tab feed updates, and interactive `購入します` → `購入しました` state changes. Added a two-page browser E2E and the exact README demo script.
- Supabase boundary: CLI/config and an unverified migration draft were started, then stopped and removed before public release. Local Supabase did not start because port 54322 was already allocated; no other project/container was inspected or stopped, no cloud was contacted, and this work is not reported as complete or connected.
- Qdrant gate: `QDRANT_URL` and `QDRANT_API_KEY` were both safely checked as unset without printing values. Per the emergency instruction, Qdrant connection work was skipped and is not reported as used.
- Demo verification: `npm run test:e2e -- tests/e2e/demo-flow.spec.ts --repeat-each=2 --workers=1` passed four runs: phone viewport 8.1s and 7.7s, desktop/family viewport 8.6s and 7.3s. Each run covered photo, voice, synthetic AI draft, edit, human confirmation, share, family-tab appearance, purchase intent and purchase completion, with external HTTP(S) requests blocked and observed count 0.
- Limitations: persistence and synchronization are browser-local, not authenticated or cross-device. Real smartphone camera/microphone permission remains a manual check. External service integrations remain explicitly unconnected.

### 2026-08-27 — Formal-development restart audit and preserved checkpoint

- Checkpoint: the working emergency demo and all tracked changes are preserved on clean `main` at commit `3a8cb24` (`feat: complete HomeRelay hackathon MVP`). No reset, force overwrite, or removal of the working demo flow was performed.
- Reconciliation: Item 1 and 2 are complete; Item 3 is partial only because its HTTPS smartphone check remains; Item 4 is complete with an explicit missing-credential fallback; Item 5 and 8 are not started; Item 6, 7, 9, and 10 are partial. `checklist.md` now records these states against the actual files.
- Working checkpoint flow: in-page photo capture, audio-only recording, deterministic synthetic AI draft, editable human confirmation, share only after `次の人へ`, browser-local family-feed update, acknowledgement/action transitions, and purchase intent/completion.
- Emergency fallbacks retained: `lib/demo-relay.ts` provides localStorage/BroadcastChannel synchronization, and `lib/ai/openai-draft.ts` is gated by an explicit synthetic fallback when credentials or live mode are absent. Neither is described as cloud or vendor connectivity.
- Formal order: HomeRelay-only Supabase schema/Auth/RLS/Storage/Realtime; confirmed-only durable sharing; attributable action/purchase transitions; Qdrant; hardening and two-device verification; only then Neo4j, Datadog, CodeRabbit, and final publication.
- Missing connectivity: there is no `.env.local`. HomeRelay-only Supabase, OpenAI, Qdrant, Neo4j, and Datadog credentials are absent; GitHub CLI authorization is invalid; CodeRabbit has no connected GitHub App/PR. Local implementation continues without claiming any of these services are connected.
- Boundary: all reads and writes in this restart audit were confined to the HomeRelay repository and the selected build-tool instruction files; no external project path, data, credential, or service was accessed.

### 2026-08-28 — Checklist 5 complete: HomeRelay-only Supabase, Auth, Storage, and RLS

- Files changed: added one clean HomeRelay migration and synthetic seed, invite-only password Auth, Next.js 16 Proxy/session clients, private `handoff-photos` Storage policies, five household-scoped tables, explicit Data API grants, confirmed-only guarded RPCs, Realtime publication, and local verification scripts.
- Security model: the authenticated user ID is mapped to exactly one household member; household IDs and actor IDs are always derived from that session. Direct client writes are denied. Cross-household rows, mutations, Storage objects, and Realtime events are denied by RLS. No service-role key is used by the app.
- Verification: `npx supabase db reset --local` passed from an empty database; pgTAP passed 2 files / 50 assertions; the security and performance advisors reported no warnings; `verify:supabase:local` passed invited login, uninvited signup rejection, same-household access, foreign-household rejection, private Storage, and entry/photo referential integrity.
- Live/fallback: the local HomeRelay Supabase stack is actually connected and verified. No cloud Supabase URL/key was supplied, so no cloud project connection is claimed. The isolated localStorage/BroadcastChannel demo remains available only when explicitly selected.

### 2026-08-28 — Checklist 6 complete: confirmed-only durable share and Realtime

- Files changed: added the formal Relay interface, Supabase and demo adapters, authenticated `/api/entries`, image signature/size validation, private upload, SHA-256-bound idempotency, safe ambiguous-error compensation, signed-photo refresh, Realtime status handling, authoritative post-subscribe refresh, and auth-subject state reset.
- Verification: a phone-width helper browser and a separate authenticated desktop-family browser completed the entire flow twice consecutively in 24.3 seconds total. Both confirmed handoffs appeared through Supabase Realtime; no live failure fell back to local demo storage. The independent Realtime script also received household-filtered entry/item events and confirmed a foreign household received none.
- Reliability adaptation: the test server uses a dedicated live port to prevent reuse of a demo process; cold local Realtime is warmed before event timing; missing private photos render an isolated placeholder instead of failing the entire feed; camera retake performs one short transient-device retry.

### 2026-08-28 — Checklist 7 complete: attributable response and purchase states

- Files changed: added guarded acknowledgement, entry claim/completion, item purchase-intent/completion RPC calls and UI ownership gates. Exact Japanese labels remain unchanged.
- Verification: pgTAP covered allowed transitions, duplicate idempotency, cross-household rejection and non-owner completion rejection. The two-client Realtime script observed `confirmed → claimed → done` and `needed → purchase_intent → purchased`; the cross-browser flow exercised the same buttons twice.
- Privacy: only operation IDs/statuses traverse these state calls; no photo, audio, name, or handoff body is logged by the application.

### 2026-08-28 — Items 5–7 checkpoint revalidation

- Database and access checks: `npx supabase test db` passed 2 files / 50 assertions; `npx supabase db lint --local --level warning` reported no schema errors; `verify:supabase:local` passed invite-only Auth, same/foreign-household RLS, guarded RPCs, private Storage, and entry/photo integrity; `verify:supabase:realtime` passed both Realtime state sequences and foreign-household non-delivery.
- Test isolation: the RLS assertions now prove every visible entry, item, and Storage path belongs to the signed-in household instead of assuming the database always contains exactly one synthetic row. This keeps the negative test valid after repeated verification runs.
- Browser checks: the synthetic demo suite passed 10 tests with 2 intentionally skipped live-only cases across phone and desktop projects. The HomeRelay local-Supabase flow then passed twice consecutively using an isolated phone-width helper context and desktop-family context; the two-run test completed in 46.2 seconds and each run enforced its own 60-second limit.
- Final checkpoint checks: `npm run verify` passed ESLint, TypeScript, 23 test files / 106 tests, and the Next.js production build. Playwright now uses a HomeRelay-local direct Next test server plus a loopback-only shutdown control so Windows test runs exit without orphaning the server.
- Scope truth: these results prove local Supabase connectivity and separate authenticated browser contexts. They do not prove a hosted Supabase project, HTTPS smartphone hardware, separate physical devices, OpenAI API, or Qdrant connectivity; those remain explicit pending gates.
