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
