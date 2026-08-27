# Technical Spec

## Stack

- Current stable Next.js App Router, TypeScript, Tailwind CSS
- Default Node.js runtime
- Dedicated new Supabase project for Database, Storage, Auth, and Realtime
- OpenAI API from server-only route for transcription and structured draft
- Qdrant for semantically related entries and duplicate needed-item candidates
- Neo4j, CodeRabbit, and Datadog only after the core demo passes twice

Verify current Next.js and Supabase documentation and changelogs before implementation. Pin dependencies and commit the lockfile.

## Architecture

```text
Mobile client
  camera + MediaRecorder
        |
        v
Next.js server routes
  validate + authorize + OpenAI
        |
        v
Human confirmation
        |
        +--> Supabase Storage + Postgres --> Supabase Realtime --> Family client
        |
        +--> Qdrant embedding/upsert/search (non-blocking)
```

Qdrant failure must not block handoff sharing. Supabase and vendor environments must be exclusive to HomeRelay.

## UI Tokens

| Purpose | Value |
|---|---|
| Heading | `#3B4642` |
| Body | `#55615D` |
| Secondary | `#6E7975` |
| Placeholder | `#7D8783` |
| Background | `#FAF8F3` |
| Card | `#FFFDF9` |
| Divider | `#E5E1D9` |
| Primary | `#426F64` |
| Warning | `#B97835` |
| Complete | `#5D8067` |

Never use pure black. Body weight 400–500, headings 500–600, buttons 600. Target 56px controls, 18px body, 24px headings. Pair icons with text and never communicate role/status by color alone.

## Data Model

### households

`id`, `name`, `created_at`

### members

`id`, `household_id`, `auth_user_id`, `display_name`, `role(family|relative|helper)`, `created_at`

### entries

`id`, `household_id`, `author_member_id`, `photo_path`, `condition_summary`, `completed_summary`, `next_request`, `status(confirmed|claimed|done)`, `created_at`

### needed_items

`id`, `household_id`, `entry_id`, `name`, `photo_path`, `status(needed|purchase_intent|purchased)`, `claimed_by_member_id`, `updated_at`

### acknowledgements

`id`, `entry_id`, `member_id`, `action(confirmed|claimed|done)`, `created_at`

## AI Contract

```json
{
  "conditionSummary": "昼食は半分ほど召し上がりました",
  "completedSummary": "水分を用意しました",
  "nextRequest": "夕方に水分をご確認ください",
  "neededItems": ["トイレットペーパー"]
}
```

Rules: concise, warm Japanese; no diagnosis; no urgency inference; no invented facts; validate the response schema server-side.

## Camera And Audio

- `getUserMedia({ video: { facingMode: { ideal: "environment" } } })`
- Draw accepted frame to canvas and convert to Blob.
- Re-encode/compress to remove EXIF/geolocation; target max long edge around 1600px.
- Stop all MediaStreamTrack instances on success, cancel, navigation, and error.
- Record with MediaRecorder; send temporary Blob to the server.
- Delete temporary audio after success, cancel, or failure.
- Never log raw audio or partial transcripts.
- Provide a capture-input fallback only when in-page camera is unavailable.

## Next.js Boundaries

- Camera, MediaRecorder, and Realtime subscriptions are Client Components.
- Prefer Server Components for initial reads.
- Use Route Handlers for OpenAI and Qdrant integrations.
- Keep server dependencies and secrets out of Client Components.
- Do not make async Client Components.
- Pass only serializable props across server/client boundaries.
- Add `error.tsx` for recoverable app errors.

## Supabase Security

- Enable RLS on every exposed table.
- `TO authenticated` is not sufficient; require membership in the row's household.
- Do not use user-editable `user_metadata` for authorization.
- UPDATE policies need SELECT plus `USING` and `WITH CHECK`.
- Storage paths and policies are household-scoped.
- Never expose service-role or secret keys to the browser.
- Realtime subscribes only to confirmed `entries` and `needed_items` changes.
- Verify the Data API exposure and grants separately from RLS.

## Qdrant

- Embed confirmed summaries only; never raw audio.
- Payload: `household_id`, `entry_id`, `type`, `created_at`, concise display text.
- Derive household from the authenticated session, not request input.
- Apply a Qdrant `household_id` filter to every query.
- Return at most three related results.
- Use cases: related prior handoffs and duplicate open needed-item warning.
- Degrade gracefully when unavailable.

## Suggested File Structure

```text
app/
├── page.tsx
├── record/page.tsx
├── entry/[id]/page.tsx
├── api/transcribe/route.ts
├── api/entries/route.ts
├── api/related/route.ts
├── error.tsx
└── layout.tsx
components/
├── CameraCapture.tsx
├── VoiceRecorder.tsx
├── ConfirmDraft.tsx
├── EntryCard.tsx
├── NeededItemCard.tsx
└── RoleBadge.tsx
lib/
├── supabase/client.ts
├── supabase/server.ts
├── openai.ts
├── qdrant.ts
├── permissions.ts
└── validation.ts
styles/tokens.css
supabase/migrations/
```

## Verification

- Typecheck, lint, unit tests, production build
- Browser verification at phone and desktop widths
- Real phone camera/microphone over HTTPS
- Two-device realtime test
- RLS negative test: a second household cannot read or mutate the first
- Secret scan and log inspection
- Qdrant household-filter test
- Winning demo succeeds twice consecutively

