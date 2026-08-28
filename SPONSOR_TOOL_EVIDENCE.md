# Sponsor Tool Evidence

最終更新: 2026-08-28 JST。`使用済み`は、このHomeRelay作業で実機能または実作業を確認できた場合だけ記載します。adapter・設定ファイル・mock testだけではlive使用済みとしません。

| ツール | 状態 | 目的 | 実装ファイル | 動作確認結果 | デモで見せる箇所 | 必要な認証情報 / 未接続理由 |
|---|---|---|---|---|---|---|
| OpenAI Codex | **使用済み** | 企画資料・要件の照合、実装、テスト、セキュリティ監査、修正記録 | リポジトリ全体、`docs/hackathon-build/checklist.md`、`build-notes.md`、Git checkpoint | lint、typecheck、cloud集中47/47、全unit 308/308、Supabase RLS/Storage/Realtime、production build、privacy/secret監査を実行 | 主導線と、checklist/build-notesの検証記録 | このCodex作業で使用。リポジトリ内API key不要 |
| OpenAI API | **未接続** | 音声文字起こしと構造化下書き | `lib/ai/openai-draft.ts`、`app/api/draft/route.ts` | live/mock・不正schema・missing-key・安全な失敗をunit test。現在のlive API呼出しは0件 | `合成AI下書き（OpenAI未接続）`表示。編集と本人確認境界は動作 | `OPENAI_API_KEY`未提供。合成fallbackをAPI使用済みと報告しない |
| Supabase | **ローカル／クラウド実接続済み・受入PASS** | invite-only Auth、Database、private Storage、Realtime、世帯membership RLS | `supabase/`、`lib/supabase/`、`lib/relay/supabase.ts`、`app/api/entries/`、`app/api/actions/`、`scripts/verify-cloud-supabase.mjs` | Cloud Project `czfmqaeqamepntpsakbv`（東京）。一般signup無効、メール確認必須、admin invite-link生成・消費、RLS 5表、private `handoff-photos`、Realtime 3表、同世帯5操作の正例と別世帯Data/全ID指定RPC/Storage/Realtime拒否を実接続確認。cleanup後Auth・5表・Storage各0 | `次の人へ`後だけ別contextへ表示、対応・購入状態のRealtime更新 | 実接続済み。Security WARN 6は監査済みguarded RPCとして受容。Performance INFO 6は将来のquery plan確認項目 |
| Qdrant | **実装済み / 未使用・live未接続** | 類似する過去の申し送り、未購入品の重複候補 | `lib/qdrant/`、`scripts/bootstrap-qdrant.mjs`、`scripts/verify-qdrant.mjs`、`app/api/entries/[entryId]/related/route.ts`、`components/RelatedHandoffsPanel.tsx` | 8 files / 55 tests。世帯filter、current除外、最大3件、RLS再検証、購入済み除外、障害fallback。verifierは`SKIP / 未接続` | live接続時は関連候補。現在は`合成候補（Qdrant未接続）`を明示 | `QDRANT_URL`、`QDRANT_API_KEY`未提供。bootstrap/read-back未実施 |
| Neo4j | **実装済み / 未使用・live未接続** | 世帯、家族、親族、ヘルパー、申し送り、対応担当、購入担当の関係投影 | `lib/neo4j/`、`app/api/actions/route.ts`、`scripts/neo4j-schema.mjs`、`scripts/bootstrap-neo4j.mjs`、`scripts/verify-neo4j.mjs`、`docs/integrations/neo4j.md` | parameterized Cypher、5 uniqueness constraints、redirect拒否、実Supabase item UUID、単調状態、非blocking同期をunit test。bootstrap/verifierは資格情報なしSKIP | 対応引受と購入後に作られる`ASSIGNED_TO`/`PURCHASE_ASSIGNEE`関係をNeo4j Browserで提示（接続後） | `NEO4J_URI`、`NEO4J_USERNAME`、`NEO4J_PASSWORD`未提供。constraint/write/read-back未実施 |
| Datadog | **実装済み / 未使用・live未接続** | API処理時間、下書き処理時間、エラー数の監視 | `lib/datadog/`、計測対象Route Handler、`scripts/verify-datadog.mjs`、`docs/integrations/datadog*` | 固定route/outcome/modeタグ、numeric値のみ、after()非blockingをunit test。verifierは資格情報なしSKIP | dashboard templateのAPI時間・AI時間・エラー数（接続後） | `DD_SITE`、`DD_API_KEY`未提供。metric ingestion/dashboard未確認 |
| CodeRabbit | **設定済み / 未使用・未接続** | 公開PRの自動レビュー、RLS・privacy・accessibility・fallback重点確認 | `.coderabbit.yaml`、`.github/pull_request_template.md` | schema v2形式、ESLint/gitleaks、path別review指示を実装。CodeRabbit bot reviewは0件 | PRのsummary、review details、修正commit（App接続後） | 正しいHomeRelay GitHub repository、CodeRabbit GitHub App、PRが未作成。設定だけを使用済みとは報告しない |
| HackerSquad | **未接続・未使用** | 当日正式環境がある場合の提出・活動証跡 | 実装なし | 認証済みの利用可能環境・機能を確認できず、外部操作なし | なし | 認証済み当日環境が提供されていないため未接続 |

## プライバシー境界

- Qdrantへ送るのは、本人確認済み要約と必要品名だけです。写真、音声、氏名は送りません。
- Neo4jへ送るのは、認証済みセッションから得た世帯/member/entry/item ID、role、action、日時、世帯scope hashだけです。写真、音声、氏名、本文、必要品名は送りません。
- Datadogへ送るのは、数値の処理時間またはエラー数と、固定低カーディナリティタグだけです。写真、音声、氏名、本文、必要品名、ID、URL、例外本文、stackは送りません。
- runtime adapterのvendor keyはすべてserver-onlyで、demoモードまたは資格情報不足時は通信前に停止します。明示的に実行する各live verifierは、有効な資格情報がある場合だけvendorへ合成検証データを送ります。Supabase cloud verifierの管理keyも検証process内だけで使い、browser、ログ、文書、Gitへ出しません。
- Supabaseの直接Data API INSERT／UPDATE拒否は、authenticatedへのtable write GRANTがないことによる`42501`の権限境界です。世帯別write RLSそのものはStorageのINSERT／UPDATE／DELETEで、Database membership境界はguarded RPCで別々に検証しています。

## 30秒説明

「OpenAI Codexで要件照合、実装、RLS、2画面Realtime、テスト、公開前監査まで進めました。SupabaseはHomeRelay専用の東京projectで実接続し、一般signup無効・メール確認必須・管理者招待経路、5表のRLS、private Storage、3表のRealtime、別世帯拒否と試験後0件cleanupを確認済みです。Security WARN 6は関数別に監査して安全設計として受容し、Performance INFO 6は将来のquery plan項目にしました。Qdrant、Neo4j、Datadog、CodeRabbitは未接続・未使用です。」

## Supabase Advisors（2026-08-28）

- Security WARN 6: lint `0029 authenticated_security_definer_function_executable`。`share_handoff`（確認済み共有）、`acknowledge_entry`（確認）、`claim_entry`（対応引受）、`complete_entry`（対応完了）、`claim_needed_item`（購入引受）、`complete_needed_item`（購入完了）を関数別に監査しました。全件`public.SECURITY DEFINER`、固定`search_path=''`で、EXECUTEは`postgres`（owner）・`authenticated`・`service_role`にあり、PUBLIC/anonにはありません。完全修飾した静的SQLで動的SQLもありません。各実行経路はprivate helper内で非null `auth.uid()`を`members.auth_user_id`へ照合し、対象世帯membershipを確認します。同世帯5 RPCの成功と最終状態をread-backし、ID指定できる5 RPCは別世帯live callを403または`42501`で拒否（401は拒否証拠に不採用）、`share_handoff`は世帯IDを受け取らず認証membershipから導出します。secret/service-roleはbrowserへ公開されていません。このためschema変更なしで安全設計として受容します。
- Performanceは初回INFO 14: covering indexがない複合foreign key 6件と、空DBで未使用と判定されたindex 8件。合成受入query後は後者が消え、現在はunindexed foreign keyのINFO 6件です。データ0件のMVPで機能・安全性を阻害しないため今回はindexを追加せず、実データ量と`EXPLAIN (ANALYZE, BUFFERS)`を確認して判断します。
- Authは一般signupだけを`disable_signup=false → true`へ変更し、`mailer_autoconfirm=false`（メール確認必須）を維持しました。signup以外の公開Auth settings hashは変更前後一致し、URL、メール、schema、migration、bucket、Realtime、API keyは変更していません。

## live使用済みに切り替える条件

1. Qdrant: `npm run qdrant:bootstrap`と`npm run verify:qdrant`がlive clusterでPASSし、別世帯候補0件を確認。
2. Neo4j: `npm run neo4j:bootstrap`が5 constraintをread-backし、`npm run verify:neo4j`が合成graphのwrite/read-back/cleanupでPASS。
3. Datadog: `npm run verify:datadog`がingestion acceptedとなり、dashboardで3指標を確認。
4. CodeRabbit: 公開PRにCodeRabbit botのreviewが付き、指摘と修正commitを記録。
5. HackerSquad: 認証済みの正式機能を実際に使い、その操作証跡を記録。
