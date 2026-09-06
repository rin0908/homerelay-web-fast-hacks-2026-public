# Project Scope

## Project Name

HomeRelay（working title）

## One-Line Summary

写真と声で30秒以内に記録し、家族・親族が5秒で理解できる、家族・親族・訪問ヘルパーのための温かい申し送りWebアプリ。

## Target User

- Invited family members
- Invited relatives
- Assigned visiting helpers
- The supported person is the subject of the handoff but is not required to operate the app.
- Works for a person living alone and for a person living with family.

## Problem

When care changes hands, the next person may not know what happened today, what needs attention, or what supplies are missing. Long text entry and administrative screens are too slow during care.

## Core Workflow

1. Take a photo inside the smartphone web app.
2. Speak a short handoff.
3. AI produces a concise draft.
4. The recorder reviews and confirms it.
5. The confirmed entry appears on another device within seconds.
6. The next person acknowledges, claims, or completes an action.
7. Needed items move from `買います` to `買いました`.

## What We Are Building

- Smartphone-first responsive web app
- In-page rear-camera capture with retake
- Voice-first input
- AI draft with mandatory human confirmation
- Photo-first `今日の様子` feed
- Realtime confirmed-entry updates
- Needed-item purchase states
- Qdrant-powered related-entry or duplicate-item result
- Synthetic two-role demo

## What We Are Not Building

- CareRelay integration or migration
- Visiting-nurse roles or records
- Helper-agency official records
- Diagnosis, medication changes, medical judgment, or emergency classification
- Live video, surveillance, or location tracking
- Native iOS or Android app
- Chat, billing, care plans, or complex notifications

## Demo Path

Helper phone creates a meal-photo handoff by voice. Family laptop receives it. Family claims and completes a supply purchase. Qdrant surfaces a related prior entry.

## Submission Story

HomeRelay is not surveillance. It is a warm relay baton between the people who provide everyday care.
