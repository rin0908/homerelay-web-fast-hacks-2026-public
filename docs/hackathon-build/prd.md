# Product Requirements Document

## Product Summary

HomeRelay reduces handoff input to a photo, a voice note, an AI-created draft, and one human confirmation. The confirmed result is immediately understandable on another device.

## Roles And Visibility

| Role | Read confirmed shared handoffs | Create handoff | Update actions/items |
|---|---:|---:|---:|
| ご家族 | Yes | Yes | Yes |
| ご親族 | Yes | Yes | Yes |
| 訪問ヘルパー | Yes, assigned household only | Yes | Yes |
| 訪問看護師 | Not a role | No | No |

Only invited members may access a household. Helpers see family-shared summaries, never an agency's official record.

## Core User Journey

1. User opens `今日の様子`.
2. User taps `写真を撮る`.
3. The rear camera starts inside the page.
4. User takes, retakes, or accepts the photo.
5. User taps `話す` and records.
6. AI returns a concise draft grouped only when useful:
   - 今日できたこと
   - 今日のご様子
   - 次の方へのお願い
   - 必要なもの
7. User corrects the draft if necessary.
8. User taps `これでOK`, then `次の人へ`.
9. Another device receives only the confirmed entry.

## Epic 1 — Photo And Voice Capture

User story: As a person providing care, I want to take a photo and speak so that I can finish a handoff quickly.

Acceptance:

- Mobile browser opens an in-page rear camera over HTTPS.
- User can take, retake, and accept a photo.
- Accepted image is not added to the phone gallery.
- User can start and stop a recording.
- Normal demo path targets 30 seconds from capture start to confirmed share.

## Epic 2 — Human-Confirmed AI Draft

User story: As the recorder, I want AI to shorten my speech without inventing facts.

Acceptance:

- AI output is visibly a draft.
- No raw or partial transcript is shared.
- User can edit before confirming.
- No data is broadcast before confirmation.
- AI does not diagnose, infer urgency, or add unspoken information.

## Epic 3 — Immediate Handoff

User story: As the next person, I want the confirmed entry to appear within seconds.

Acceptance:

- A second subscribed device receives the confirmed entry within seconds under normal network conditions.
- Card shows photo, concise text, timestamp, name, and text role badge.
- General action labels are exactly `見ました`, `私がやります`, `できました`.
- The updater is attributable.

## Epic 4 — Needed Items

User story: As a family member or helper, I want to claim and complete a purchase without duplicate buying.

Acceptance:

- Section title is `必要なもの`.
- Buttons are exactly `買います` and `買いました`.
- Do not use `購入します`, `購入しました`, `届けました`, `補充しました`, or `補充済み`.
- Claiming records the member.
- Qdrant can return a related unpurchased item or prior handoff.

## Edge Cases

- Camera denied: show `カメラを許可してください` and retry.
- Microphone denied: show `マイクを許可してください` and retry.
- AI error: show `もう一度話す`; do not log or retain raw audio.
- Share error: retain local draft and show `もう一度送る`; never claim it was shared.
- Retake/cancel: discard temporary photo/audio and stop media tracks.
- Duplicate tap: use an idempotency key to prevent duplicate records.
- Empty feed: show calm whitespace and the primary capture action, not a paragraph.

## Submission Proof Points

- Real in-page camera on a phone
- Voice-to-structured draft
- Human confirmation boundary
- Two-device realtime update
- Qdrant semantic result with household filter
- Warm, minimal Japanese UI
