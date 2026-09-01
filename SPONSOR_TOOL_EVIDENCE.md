# Sponsor Tool Evidence

最終更新: 2026-09-01 JST。`使用済み`は、このHomeRelay作業で実機能または実作業を確認できた場合だけ記載します。adapter・設定ファイル・mock testだけではlive使用済みとしません。

| ツール | 状態 | 目的 | 実装ファイル | 動作確認結果 | デモで見せる箇所 | 必要な認証情報 / 未接続理由 |
|---|---|---|---|---|---|---|
| OpenAI Codex | **使用済み** | 企画資料・要件の照合、実装、テスト、セキュリティ監査、修正記録 | リポジトリ全体、`docs/hackathon-build/checklist.md`、`build-notes.md`、Git checkpoint | lint、typecheck、cloud集中47/47、全unit 433/433、synthetic E2E 16/16、Supabase RLS/Storage/Realtime、production build、実秘密値照合privacy/secret監査を実行 | 主導線と、checklist/build-notesの検証記録 | このCodex作業で使用。リポジトリ内API key不要 |
| OpenAI API | **実接続済み・live検証PASS** | 合成音声文字起こしと本人確認前のstrict構造化下書き | `lib/ai/openai-draft.ts`、`lib/ai/request-guard.ts`、`app/api/draft/route.ts`、`components/VoiceRecorder.tsx`、`components/ConfirmDraft.tsx`、`scripts/verify-openai.mjs`、関連tests | HomeRelay専用Projectで6.97秒の合成ja-JP WAVを検証。`gpt-4o-mini-transcribe`＋`gpt-5-mini`がPASS。安全な初回502を含む最終Dashboard集計は3 requests / 588 input / 419 output tokens。組織残高$18.18→$18.18、Project表示使用額$0.00→$0.00、$1 hard limit不変。UIは30秒で自動停止し、routeは申告duration／実byte上限とメンバー／世帯のrate・concurrency guardを適用。local verifierは非production・loopback・一時token必須。本人確認前の保存・共有0、失敗時は空の手入力、一時WAV残存0 | live下書き、編集、`これでOK`時点の非共有、AI失敗時の空手入力、`次の人へ`後だけ共有される境界 | `OPENAI_API_KEY`と`OPENAI_PROJECT_ID`をserver-onlyで使用。一時verifier tokenを含む値・response body・本文はログ／文書／Gitへ保存していない |
| Supabase | **ローカル／クラウド実接続済み・受入PASS** | invite-only Auth、Database、private Storage、Realtime、世帯membership RLS | `supabase/`、`lib/supabase/`、`lib/relay/supabase.ts`、`app/api/entries/`、`app/api/actions/`、`scripts/verify-cloud-supabase.mjs` | Cloud Project `czfmqaeqamepntpsakbv`（東京）。一般signup無効、メール確認必須、admin invite-link生成・消費、RLS 5表、private `handoff-photos`、Realtime 3表、同世帯5操作の正例と別世帯Data/全ID指定RPC/Storage/Realtime拒否を実接続確認。cleanup後Auth・5表・Storage各0 | `次の人へ`後だけ別contextへ表示、対応・購入状態のRealtime更新 | 実接続済み。Security WARN 6は監査済みguarded RPCとして受容。Performance INFO 6は将来のquery plan確認項目 |
| Qdrant | **実接続済み・live検証PASS** | 類似する過去の申し送り、未購入品の重複候補 | `lib/qdrant/`、`scripts/bootstrap-qdrant.mjs`、`scripts/verify-qdrant.mjs`、`app/api/entries/[entryId]/related/route.ts`、`components/RelatedHandoffsPanel.tsx` | Qdrant Cloud Free `homerelay-qdrant`はHealthy。bootstrap、Cloud Inferenceの類似申し送り／必要品、別世帯filter、検証point削除後0件read-backがlive PASS。9 files / 68 focused testsもPASS | liveの関連申し送り／必要品候補と別世帯非混入。明示demo modeでは引き続き`合成候補` | server-only設定で実接続済み。endpoint／keyの実値はこの文書へ記録しない |
| Neo4j | **実接続済み・live検証PASS** | 世帯、家族、親族、ヘルパー、申し送り、対応担当、購入担当の関係投影 | `lib/neo4j/`、`app/api/actions/route.ts`、`scripts/neo4j-schema.mjs`、`scripts/bootstrap-neo4j.mjs`、`scripts/verify-neo4j.mjs`、`docs/integrations/neo4j.md` | AuraDB Free `homerelay-graph`はRunning。5 constraints、Home／foreign graphのparameterized write、関係read-back、Home filterでforeign 0件、両世帯cleanup後node／relationship各0件がlive PASS。2026 Auraのinstance identifier username／database形式にも対応 | `ASSIGNED_TO`／`PURCHASE_ASSIGNEE`を含む関係read-backとforeign非混入 | server-only設定で実接続済み。URI／username／password／instance identifierの実値はこの文書へ記録しない |
| Datadog | **実装済み / 未使用・live未接続** | API処理時間、下書き処理時間、エラー数の監視 | `lib/datadog/`、計測対象Route Handler、`scripts/verify-datadog.mjs`、`docs/integrations/datadog*` | 固定route/outcome/modeタグ、numeric値のみ、after()非blockingをunit test。AP1 Japanの新規登録では異なる2つのメールで認証コード送信／再送信がDatadog側の「不明なエラー」になったため、同じ操作を停止 | dashboard templateのAPI時間・AI時間・エラー数（接続後） | API key未作成・未保存。metric ingestionとUI read-backは未実行なので未接続・未使用。他工程後に登録を1回だけ再試行 |
| CodeRabbit | **接続・トリガー済み / レビュー未実施・未使用** | PRIVATE GitHub repositoryのPRレビュー、RLS・privacy・accessibility・fallback重点確認 | `.coderabbit.yaml`、`.github/pull_request_template.md` | GitHub Appを`rin0908/homerelay-web-fast-hacks-2026`だけへ接続しPR #1でトリガー。PRIVATE repositoryのFree plan制限によりbot reviewは実行されず、指摘件数は「0件」ではなく未取得 | review summary、details、修正commitはレビュー実行後のみ提示 | 有料化、Pro trial、公開化、mergeは未実行。現状を使用済みとは報告しない |
| HackerSquad | **builder認証確認済み / 提出未実行** | 対象イベントへのproject提出 | 実装なし | builder loginは成功。対象イベントはArchivedで、提出ボタンとproject導線は表示されなかった | なし | project作成・提出は未実行。認証確認だけを使用済み／提出済みとは報告しない |

## プライバシー境界

- Qdrantへ送るのは、本人確認済み要約と必要品名だけです。写真、音声、氏名は送りません。
- Neo4jへ送るのは、認証済みセッションから得た世帯/member/entry/item ID、role、action、日時、世帯scope hashだけです。写真、音声、氏名、本文、必要品名は送りません。
- Datadogへ送るのは、数値の処理時間またはエラー数と、固定低カーディナリティタグだけです。写真、音声、氏名、本文、必要品名、ID、URL、例外本文、stackは送りません。
- OpenAI live検証は個人情報を含まない6.97秒の合成音声だけを使用し、API key、response body、文字起こし本文、下書き本文、一時verifier tokenをログへ出していません。一時WAVは検証後に削除し、残存0件を確認しました。通常の有料routeはUI 30秒自動停止、申告duration／実byte上限、メンバー／世帯のin-runtime rate・concurrency guardを使います。音声本体のdurationをserver側で独立decodeするものではありません。AI失敗時は空の手入力へ進み、確認前には保存されません。
- runtime adapterのvendor keyはすべてserver-onlyで、demoモードまたは資格情報不足時は通信前に停止します。明示的に実行する各live verifierは、有効な資格情報がある場合だけvendorへ合成検証データを送ります。Supabase cloud verifierの管理keyも検証process内だけで使い、browser、ログ、文書、Gitへ出しません。
- Supabaseの直接Data API INSERT／UPDATE拒否は、authenticatedへのtable write GRANTがないことによる`42501`の権限境界です。世帯別write RLSそのものはStorageのINSERT／UPDATE／DELETEで、Database membership境界はguarded RPCで別々に検証しています。

## 30秒説明

「OpenAI Codexで要件照合・実装・監査を行い、OpenAI APIは合成音声の文字起こしとstrict構造化下書きをlive確認しました。本人確認前は保存・共有されません。Supabaseは招待制Auth、5表RLS、private Storage、Realtime、別世帯拒否、試験後0件cleanupまで確認済みです。Qdrant Cloud FreeはCloud Inferenceと別世帯filter、Neo4j AuraDB Freeは関係graphとcleanupをlive確認しました。Datadogは未接続、CodeRabbitは接続・トリガー済みですがレビュー未実施、HackerSquadはArchivedイベントのため未提出です。」

## Supabase Advisors（2026-08-28）

- Security WARN 6: lint `0029 authenticated_security_definer_function_executable`。`share_handoff`（確認済み共有）、`acknowledge_entry`（確認）、`claim_entry`（対応引受）、`complete_entry`（対応完了）、`claim_needed_item`（購入引受）、`complete_needed_item`（購入完了）を関数別に監査しました。全件`public.SECURITY DEFINER`、固定`search_path=''`で、EXECUTEは`postgres`（owner）・`authenticated`・`service_role`にあり、PUBLIC/anonにはありません。完全修飾した静的SQLで動的SQLもありません。各実行経路はprivate helper内で非null `auth.uid()`を`members.auth_user_id`へ照合し、対象世帯membershipを確認します。同世帯5 RPCの成功と最終状態をread-backし、ID指定できる5 RPCは別世帯live callを403または`42501`で拒否（401は拒否証拠に不採用）、`share_handoff`は世帯IDを受け取らず認証membershipから導出します。secret/service-roleはbrowserへ公開されていません。このためschema変更なしで安全設計として受容します。
- Performanceは初回INFO 14: covering indexがない複合foreign key 6件と、空DBで未使用と判定されたindex 8件。合成受入query後は後者が消え、現在はunindexed foreign keyのINFO 6件です。データ0件のMVPで機能・安全性を阻害しないため今回はindexを追加せず、実データ量と`EXPLAIN (ANALYZE, BUFFERS)`を確認して判断します。
- Authは一般signupだけを`disable_signup=false → true`へ変更し、`mailer_autoconfirm=false`（メール確認必須）を維持しました。signup以外の公開Auth settings hashは変更前後一致し、URL、メール、schema、migration、bucket、Realtime、API keyは変更していません。

## 外部連携の完了条件と現在地

1. Qdrant: **完了**。Cloud Free clusterでbootstrap、Cloud Inference、別世帯filter、cleanup 0件がPASS。
2. Neo4j: **完了**。AuraDB Freeで5 constraints、Home／foreign graph write、関係read-back、foreign 0件、両世帯cleanup 0件がPASS。
3. Datadog: API keyを保存せずlive未実行。`npm run verify:datadog`の202受付後、固定tagでUI read-backするまで未接続。
4. CodeRabbit: PRIVATE GitHub repositoryのPRにCodeRabbit botのreviewが付き、指摘と修正commitを記録。
5. HackerSquad: builder loginのみ確認済み。対象イベントがArchivedのため、提出可能な正式導線が確認できるまで未提出。
