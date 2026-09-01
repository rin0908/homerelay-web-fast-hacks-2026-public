# Build Checklist

## Build Preferences

- **Build mode:** Autonomous
- **Comprehension checks:** N/A
- **Git:** Commit after core UI/capture, realtime/data, and final verification
- **Verification:** Yes; do not mark an item complete without its check
- **Check-in cadence:** Speed-run; pause only for missing external credentials or a manual phone permission check
- **Wow moment:** Voice/photo handoff appears on the family screen within seconds, followed by a Qdrant duplicate warning

## Checklist

- [x] **1. Confirm isolation and scaffold the app — Complete**
  Spec ref: `spec.md > Stack` and `AGENTS.md > Hard boundary`
  What to build: Confirm the absolute HomeRelay-only path, inspect only this repository, scaffold current stable Next.js with pinned dependencies, and create a synthetic-data development mode.
  Acceptance: App starts; no CareRelay path or dependency exists; `.env.example` contains names only and no secrets.
  Verify: `pwd`, `git status --short`, dependency audit, and repository-wide search for forbidden external paths.

- [x] **2. Build the warm responsive shell — Complete**
  Spec ref: `spec.md > UI Tokens`; `prd.md > Core User Journey`
  What to build: Implement `今日の様子`, role badges, photo-first cards, exact Japanese button text, phone/desktop layouts, loading/empty/error states.
  Acceptance: No pure black, no heavy typography, primary controls are large and labeled, forbidden item wording is absent.
  Verify: Lint/typecheck plus visual check at approximately 390px and 1280px widths.

- [ ] **3. Implement in-page camera capture — Partial**
  Current status: HTTPS Previewで実iPhoneの背面カメラ撮影と許可は確認済みです。通常SafariのURLバーを避けるstandalone PWA metadataとホーム画面追加案内、`カメラを開く`から一度だけ自動開始する導線も実装し、Strict Mode、permission error、phone/desktop E2Eを通過しました。更新後Previewでのstandalone物理再確認だけが残ります。
  Spec ref: `spec.md > Camera And Audio`; `prd.md > Epic 1`
  What to build: Rear-camera preview, capture, retake, accept, cleanup, image re-encoding/compression, and fallback only when needed.
  Acceptance: On HTTPS phone, user can capture without selecting a saved photo; tracks stop and temporary images are discarded on retake/cancel.
  Verify: Browser tests for state logic and one manual smartphone camera-permission check.

- [x] **4. Implement voice recording and AI draft — Complete and live verified**
  Current status: The server-only adapter, strict schema checks, editing, and confirmation boundary pass. A 6.97-second synthetic ja-JP WAV completed live transcription with `gpt-4o-mini-transcribe` and strict structured drafting with `gpt-5-mini` in the HomeRelay-only OpenAI Project. Normal paid calls require Supabase live mode plus an invited authenticated session. The UI auto-stops at 30 seconds; the route validates the declared duration and an actual 2 MiB byte ceiling, then applies an in-runtime member/household rate and concurrency guard before the vendor call. It does not claim independent server-side media-duration decoding. The local verifier exception is non-production, loopback-bound, explicit opt-in, and protected by a one-time token. Explicit demo mode retains the labeled deterministic fallback, while a live failure returns a safe 502 and opens an empty manual form without being reported as fallback success.
  Spec ref: `spec.md > AI Contract`; `prd.md > Epic 2`
  What to build: MediaRecorder flow, server-only transcription/structuring route, schema validation, editable confirmation, safe error and synthetic demo fallback.
  Acceptance: Demo phrase produces a concise draft; nothing is shared before confirmation; raw audio/partial transcript is not logged or retained.
  Verify: Component test for one-time 30-second auto-stop, track release, and submission; route tests for valid, invalid, missing-key, authenticated/unauthenticated access, production/flag-off verifier rejection, declared-duration/actual-byte/rate/concurrency bounds, loopback/token isolation, empty-transcript, fixed safe error classes, strict schema, and empty manual fallback; inspect content-free logs; manually edit a draft. 2026-08-30 live evidence: Dashboard 3 requests / 588 input / 419 output tokens, organization balance $18.18→$18.18, Project display spend $0.00→$0.00, $1 hard limit unchanged, pre-confirmation save/share 0, temporary WAV residual 0.

- [x] **5. Add HomeRelay-only Supabase schema and RLS — Complete and cloud verified**
  Current status: Migration `20260827114534_homerelay_core` is applied only to the dedicated HomeRelay project `czfmqaeqamepntpsakbv` in `ap-northeast-1`. General signup is disabled, email confirmation remains required, and the server-only admin invite-link generation/redemption path passes. Five public tables have RLS enabled, `handoff-photos` is private, and three tables are in the Realtime publication. Hosted same-household access and action transitions plus foreign-household SELECT/guarded-RPC/Storage/Realtime denial pass. Security Advisors WARN 6 are accepted as the intended guarded RPC boundary after the function audit below; current Performance INFO 6 are deferred to measured query-plan review for the empty-data MVP.
  Spec ref: `spec.md > Data Model` and `Supabase Security`
  What to build: Clean migrations for tables, indexes, Storage rules, household membership policies, and synthetic seed data. Verify current Supabase docs/changelog first.
  Acceptance: Same-household access works; another household cannot select, insert, update, or access photos.
  Verify: SQL/RLS positive and negative tests; Supabase advisors where available.

- [x] **6. Save confirmed handoffs and update in realtime — Complete and physically verified**
  Current status: Supabase mode stores only the human-confirmed handoff, private photo and SHA-256-bound idempotency payload, then refreshes a separate authenticated browser context through Postgres Changes. A hosted cloud verifier received an `entries` event for the same household and no event for the foreign household; publication read-back confirms `entries`, `needed_items`, and `acknowledgements`. An actual iPhone helper session shared a confirmed handoff to a separate Windows family session over HTTPS Realtime. The browser-local relay remains a separately labeled demo fallback and is never used after a live failure.
  Spec ref: `prd.md > Epic 3`; `spec.md > Architecture`
  What to build: Confirm/share mutation, idempotency, upload/storage ordering, confirmed-only Realtime subscription, optimistic UI with failure rollback.
  Acceptance: Second device receives a confirmed entry within seconds; drafts never appear; failed share never appears successful.
  Verify: Two-browser and two-device test with timestamps; duplicate-click test.

- [x] **7. Implement action and needed-item states — Complete and locally verified**
  Current status: `見ました`, `私がやります`, `できました`, `買います`, and `買いました` use session-derived guarded RPCs, durable attribution, ownership checks, idempotent repeats, and Realtime updates. Each tap now updates the UI immediately; rapid operations are authenticated once per batch, sent in order, read back from Supabase, rolled back on failure, and flushed with keepalive before page exit. Neo4j receives both purchase-intent and purchased events without becoming an authorization source. Focused transition, concurrency, failure, and two-client tests pass.
  Spec ref: `prd.md > Epic 3` and `Epic 4`
  What to build: General acknowledgement/claim/done flow and needed-item purchase intent/purchased flow with attribution.
  Acceptance: Exact words are used; transitions persist and update another device; duplicate claims are handled safely.
  Verify: State-transition tests and two-client manual check.

- [x] **8. Integrate Qdrant meaningfully — Complete and live verified**
  Current status: The server-only Cloud Inference adapter, deterministic upsert, household/type/current-entry filters, Supabase RLS candidate revalidation, collection bootstrap, live verifier, non-blocking fallback, and related-candidate UI are implemented. The Qdrant Cloud Free cluster `homerelay-qdrant` is Healthy, bootstrap succeeded, and the live verifier passed Cloud Inference for a related handoff and needed item while excluding the foreign household. Every synthetic verification point was deleted and read back as 0; no credential value is recorded here.
  Spec ref: `spec.md > Qdrant`; `prd.md > Submission Proof Points`
  What to build: Server-only embedding/upsert/query adapter, collection bootstrap note/script, household-filtered related entries, duplicate open-item warning, graceful fallback.
  Acceptance: Live credentials produce at least one semantic result; cross-household records never return; Qdrant downtime does not block sharing.
  Verify: Live integration test, filter-negative test, and forced-unavailable test. Clearly label demo fallback if credentials are absent.

- [x] **9. Harden privacy, errors, and accessibility — Complete locally**
  Current status: Real-byte streaming limits cover JSON and multipart requests even without a trustworthy Content-Length; malformed bodies return 400 and over-limit bodies return 413. Server authorization, household policies, focus/labels, dynamic-state axe scans, security headers/CSP, non-PII monitoring boundaries, dependency audit, reachable-history secret scan, client-bundle scan, and production build pass. Hosted vendor connections are separate credential gates, not hidden acceptance claims.
  Spec ref: `spec.md > Verification`; `prd.md > Edge Cases`
  What to build: Permission errors, cleanup, size/MIME limits, server authorization, focus and labels, reduced motion, secret-safe monitoring boundaries.
  Acceptance: Keyboard use is possible, errors are short and actionable, secrets/content are absent from client bundle and logs.
  Verify: Unit/integration tests, accessibility scan, secret scan, production build.

- [ ] **10. Run the winning demo twice and prepare handoff — Local evidence complete; external/manual gates pending**
  Current status: The offline synthetic suite passes 16 browser tests with the final action wording, one-tap camera start, and explicit AI-failure manual path; the full demo flow previously passed twice on 390px and twice on desktop. The HomeRelay local-Supabase flow passed twice consecutively between an isolated 390px helper context and a separate desktop family context in one 53.4-second test. A Vercel HTTPS Preview and actual iPhone helper plus separate Windows family session completed the live central flow, including Realtime actions and purchase completion, but the recorded end-to-end time was about 121 seconds; two consecutive runs within 60 seconds have not passed. The PRIVATE GitHub repository and PR #1 exist, but CodeRabbit did not review the PR under the PRIVATE Free limitation. OpenAI, Supabase, Qdrant Cloud Free, and Neo4j AuraDB Free are live verified; Datadog is unconnected/unused, and HackerSquad is Archived/unsubmitted. The updated Preview still needs a physical standalone regression before the 60-second goal is reassessed.
  Spec ref: `CODEX_START_HERE.md > Winning demo`
  What to build: Seed deterministic synthetic data, write exact run/deploy instructions, capture verification notes, and list live versus fallback integrations.
  Acceptance: The 60-second flow succeeds twice consecutively on a phone and family screen.
  Verify: Record timestamps and results in `build-notes.md`; ensure the next step is submission preparation only when the user says the project feels ready.

## 2026-08-28 cloud pre-publication verification

- Project: `czfmqaeqamepntpsakbv`, `ap-northeast-1`, migration `20260827114534_homerelay_core` applied.
- Schema: RLS enabled on 5/5 public tables; no policy references `user_metadata`. Private bucket `handoff-photos`; Realtime publication contains 3 expected tables.
- Auth: official current docs/changelog and CLI 2.116.0 help were checked. Dashboard changed only general signup (`disable_signup=false → true`); `mailer_autoconfirm=false` and Confirm email ON remain. The SHA-256 of every other public Auth setting is unchanged. `config push` was not used. Uninvited `.test` signup is rejected; server-only `generateLink(type=invite)` succeeds and its hashed token is redeemed with `verifyOtp(type=invite)`.
- Authorization: all five same-household action RPCs succeed and persist the expected final states. Foreign household SELECT returns no row; all five ID-targeted guarded RPCs reject the foreign household with authenticated SQL/RLS denial (`403` or `42501`, never merely `401`); `share_handoff` accepts no household ID and derives it from membership. Storage SELECT/INSERT/UPDATE/DELETE are household-scoped. Direct Data API INSERT/UPDATE return `42501` because authenticated has no direct table-write GRANT; this is a privilege-boundary test, not a claim that public-table write RLS was exercised.
- Security WARN 6 acceptance: `share_handoff` (confirmed share), `acknowledge_entry` (confirm), `claim_entry`/`complete_entry` (take/finish), and `claim_needed_item`/`complete_needed_item` (buy/purchased) are all `public.SECURITY DEFINER` with `search_path=''`; EXECUTE is held by `postgres` (owner), `authenticated`, and `service_role`, while PUBLIC/anon have none. Every path calls private helpers that validate non-null `auth.uid()` against `members.auth_user_id`, then constrains the target to the derived household; completion also requires the same claimant. Inputs are values in fixed, fully qualified SQL with no dynamic SQL. service-role is absent from browser configuration and bundles. The warnings are therefore intentional and accepted without schema changes.
- Performance INFO 6: the remaining notices are covering-index suggestions for composite household foreign keys. With zero retained MVP rows and no functional or security effect, no index is added now; data volume and `EXPLAIN (ANALYZE, BUFFERS)` will drive a later decision.
- Cleanup: the verifier accepts only distinct `.test` Auth users and known synthetic IDs. Storage, child-first Database, then Auth cleanup succeeded once. Immediate and delayed verifier checks plus an independent SQL read-back found Auth users 0, each of the five public tables 0 rows, and `handoff-photos` objects 0.
- Final local verification: focused cloud verifier 47/47, full unit 42/42 files with 308/308 tests, lint, typecheck, production build, privacy audit, added-secret scan, and `git diff --check` all pass. The privacy audit checked 160 publishable files, reachable Git history, and 37 browser-delivered build files.
