# HomeRelay Codex Instructions

## Hard boundary

- This repository is a brand-new HomeRelay hackathon project.
- Never read, search, copy, edit, import, move, or delete anything belonging to CareRelay.
- Never reuse CareRelay repositories, databases, APIs, environment variables, documents, Google Drive files, or user data.
- Work only inside this repository unless the user explicitly provides a different HomeRelay-only path.
- Use synthetic demo data only. Never enter real care-recipient, family, helper, medical, or household data.

## Product boundary

- Users: invited family members, invited relatives, and assigned visiting helpers.
- Visiting nurses are not users and must not appear in roles, permissions, screens, or demo data.
- Store only a family-shared handoff summary. Do not model or store a helper agency's official service record.
- Do not add diagnosis, medication changes, medical judgment, emergency classification, live video, location tracking, or surveillance.

## Build behavior

- Start by reading `CODEX_START_HERE.md`, then every file in `docs/hackathon-build/`.
- Follow `docs/hackathon-build/checklist.md` in order.
- Optimize for a reliable 60-second demo, not feature count.
- Complete and verify the core flow before adding Neo4j, CodeRabbit, Datadog, or other stretch work.
- Keep secrets server-side. Never expose service-role or vendor API keys to the browser.
- After each checklist item, run its verification and update the checklist and build notes.
- If a required credential is missing, keep the adapter and a clearly labeled synthetic demo fallback; do not fabricate a successful live integration.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
