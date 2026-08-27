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
  Current status: Implementation and automated browser coverage pass; the required HTTPS smartphone permission/camera check is still pending.
  Spec ref: `spec.md > Camera And Audio`; `prd.md > Epic 1`
  What to build: Rear-camera preview, capture, retake, accept, cleanup, image re-encoding/compression, and fallback only when needed.
  Acceptance: On HTTPS phone, user can capture without selecting a saved photo; tracks stop and temporary images are discarded on retake/cancel.
  Verify: Browser tests for state logic and one manual smartphone camera-permission check.

- [x] **4. Implement voice recording and AI draft — Complete with explicit credential fallback**
  Current status: The server-only adapter, schema checks, editing, and confirmation boundary pass. Live OpenAI is unconnected; the UI truthfully labels the deterministic synthetic fallback.
  Spec ref: `spec.md > AI Contract`; `prd.md > Epic 2`
  What to build: MediaRecorder flow, server-only transcription/structuring route, schema validation, editable confirmation, safe error and synthetic demo fallback.
  Acceptance: Demo phrase produces a concise draft; nothing is shared before confirmation; raw audio/partial transcript is not logged or retained.
  Verify: Route tests for valid, invalid, and missing-key cases; inspect logs; manually edit a draft.

- [x] **5. Add HomeRelay-only Supabase schema and RLS — Complete and locally verified**
  Current status: A dedicated HomeRelay migration, invite-only Auth, private Storage, synthetic seed, explicit grants, membership RLS, guarded RPCs, and Realtime publication are implemented. Local Auth/Data API/Storage tests and 50 pgTAP assertions pass; a cloud project is not connected because its credentials are absent.
  Spec ref: `spec.md > Data Model` and `Supabase Security`
  What to build: Clean migrations for tables, indexes, Storage rules, household membership policies, and synthetic seed data. Verify current Supabase docs/changelog first.
  Acceptance: Same-household access works; another household cannot select, insert, update, or access photos.
  Verify: SQL/RLS positive and negative tests; Supabase advisors where available.

- [x] **6. Save confirmed handoffs and update in realtime — Complete and locally verified**
  Current status: Supabase mode stores only the human-confirmed handoff, private photo and SHA-256-bound idempotency payload, then refreshes a second authenticated client through Postgres Changes. The browser-local relay remains a separately labeled demo fallback and is never used after a live failure.
  Spec ref: `prd.md > Epic 3`; `spec.md > Architecture`
  What to build: Confirm/share mutation, idempotency, upload/storage ordering, confirmed-only Realtime subscription, optimistic UI with failure rollback.
  Acceptance: Second device receives a confirmed entry within seconds; drafts never appear; failed share never appears successful.
  Verify: Two-browser and two-device test with timestamps; duplicate-click test.

- [x] **7. Implement action and needed-item states — Complete and locally verified**
  Current status: `確認しました`, `私が対応します`, `対応しました`, `購入します`, and `購入しました` use session-derived guarded RPCs, durable attribution, ownership checks, idempotent repeats, and Realtime updates. The two-client integration test passes every transition.
  Spec ref: `prd.md > Epic 3` and `Epic 4`
  What to build: General acknowledgement/claim/done flow and needed-item purchase intent/purchased flow with attribution.
  Acceptance: Exact words are used; transitions persist and update another device; duplicate claims are handled safely.
  Verify: State-transition tests and two-client manual check.

- [ ] **8. Integrate Qdrant meaningfully — Implementation complete; live credential gate pending**
  Current status: The server-only Cloud Inference adapter, deterministic upsert, household/type/current-entry filters, Supabase RLS candidate revalidation, collection bootstrap, live verifier, non-blocking fallback, and related-candidate UI are implemented. Unit/API/component tests pass. `QDRANT_URL` and `QDRANT_API_KEY` are absent, so bootstrap/live search were not run and this item is not marked complete.
  Spec ref: `spec.md > Qdrant`; `prd.md > Submission Proof Points`
  What to build: Server-only embedding/upsert/query adapter, collection bootstrap note/script, household-filtered related entries, duplicate open-item warning, graceful fallback.
  Acceptance: Live credentials produce at least one semantic result; cross-household records never return; Qdrant downtime does not block sharing.
  Verify: Live integration test, filter-negative test, and forced-unavailable test. Clearly label demo fallback if credentials are absent.

- [ ] **9. Harden privacy, errors, and accessibility — Partial**
  Current status: Media cleanup, MIME/size checks, keyboard labels, accessibility scans, secret scans, and builds pass for the checkpoint. Server authorization, household policies, monitoring boundaries, and final live-mode scans remain.
  Spec ref: `spec.md > Verification`; `prd.md > Edge Cases`
  What to build: Permission errors, cleanup, size/MIME limits, server authorization, focus and labels, reduced motion, secret-safe monitoring boundaries.
  Acceptance: Keyboard use is possible, errors are short and actionable, secrets/content are absent from client bundle and logs.
  Verify: Unit/integration tests, accessibility scan, secret scan, production build.

- [ ] **10. Run the winning demo twice and prepare handoff — Partial**
  Current status: The browser-local synthetic flow passed two consecutive automated phone/desktop viewport runs. A real smartphone plus separate PC, live Realtime/Qdrant, deploy instructions, and final two-run evidence remain.
  Spec ref: `CODEX_START_HERE.md > Winning demo`
  What to build: Seed deterministic synthetic data, write exact run/deploy instructions, capture verification notes, and list live versus fallback integrations.
  Acceptance: The 60-second flow succeeds twice consecutively on a phone and family screen.
  Verify: Record timestamps and results in `build-notes.md`; ensure the next step is submission preparation only when the user says the project feels ready.
