# Codex Start Here — HomeRelay

Build this project autonomously from the checklist in `docs/hackathon-build/checklist.md`.

## First response before editing

Report only these items:

1. Confirm the absolute working directory.
2. Confirm that no CareRelay path will be accessed.
3. State the first three checklist items.
4. List missing credentials without blocking UI work.

Then begin implementation immediately. Do not ask the user to repeat requirements already written in this repository.

## Product sentence

HomeRelay is a warm, smartphone-first web app that lets family members, relatives, and visiting helpers create a handoff in under 30 seconds using an in-app photo and voice, then makes the confirmed summary appear on another device within seconds.

## Winning demo

1. Open `今日の様子` on a family laptop.
2. On a helper phone, tap `写真を撮る` and photograph a synthetic meal.
3. Tap `話す` and say: `昼食は半分ほど。水分を用意しました。トイレットペーパーが少ないです。`
4. AI creates a short draft.
5. Tap `これでOK`, then `次の人へ`.
6. The family laptop updates within seconds.
7. The family taps `見ました`, `私がやります`, then `できました`.
8. The family taps `買います`, then `買いました`.
9. Qdrant shows a semantically related prior supply handoff or duplicate-item warning.

## Build order

`warm UI → in-page camera → voice → AI confirmation → realtime share → needed-item states → Qdrant → verification`

## Stop rule

Do not start Neo4j, CodeRabbit, or Datadog until the complete winning demo succeeds twice.

## Required completion report

- What works
- What remains a demo fallback
- Exact commands run and their results
- Environment variables still required
- Manual smartphone checks still required
- Confirmation that CareRelay was untouched
