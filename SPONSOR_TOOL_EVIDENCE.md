# Sponsor Tool Evidence

最終更新: 2026-08-27 JST。`使用済み`は、このHomeRelay作業で実機能または実作業として確認できたものだけです。

| ツール | 状態 | 目的 | 実装・証拠 | 動作確認 | デモで見せる箇所 | 必要な認証情報 / 未接続理由 |
|---|---|---|---|---|---|---|
| OpenAI Codex | **使用済み** | 企画資料の読解、要件整理、実装、テスト、修正 | リポジトリ全体、`docs/hackathon-build/build-notes.md`、テスト一式、ローカルGit履歴 | lint、typecheck、34 unit tests、2タブE2E、production buildをCodexが実行 | 写真→声→下書き→本人確認→別タブ共有→購入の完成導線 | このCodexセッションで使用。リポジトリ内のAPIキーは不要 |
| OpenAI API | **未接続** | 音声文字起こしと構造化下書き | `lib/ai/openai-draft.ts`、`app/api/draft/route.ts`にはserver-only adapterあり | missing-key・不正schema・安全な失敗をmockで検証。ライブAPI呼出しは0件 | `合成AI下書き（OpenAI未接続）`表示 | `OPENAI_API_KEY`なし。合成fallbackのみで、API使用済みとは報告しない |
| Qdrant | **未接続・未使用** | 類似する過去の申し送りと必要品重複候補 | SDK依存と環境変数名のみ。機能接続は実施していない | `QDRANT_URL=false`、`QDRANT_API_KEY=false`を値を出さず確認 | デモ箇所なし | 両認証情報が未設定。緊急方針に従い新規接続を中止 |
| Neo4j | **未接続・未使用** | 関係グラフ | 実装なし | 未実施 | なし | 緊急方針により中止。`NEO4J_URI`、`NEO4J_USERNAME`、`NEO4J_PASSWORD`も未提供 |
| Datadog | **未接続・未使用** | API/AI時間とエラー数の監視 | 実装なし | 未実施。個人情報送信0件 | なし | 緊急方針により中止。`DATADOG_API_KEY`なし |
| CodeRabbit | **未接続・未使用** | 完成コードの外部レビュー | 実装・PRレビューなし | 未実施 | なし | Git remote / PR / GitHub App接続なし。緊急方針により中止 |
| HackerSquad | **未接続・未使用** | 当日イベント環境・提出 | 実装・提出なし | 正式に利用可能な認証済み環境を確認できず未実施 | なし | 緊急方針により中止 |

## 30秒説明

「OpenAI Codexで要件から実装、34件の単体テスト、2タブE2E、ビルドまで完走しました。OpenAI APIとQdrantを含む外部サービスは資格情報がないため未接続で、画面も合成デモと明示しています。Neo4j、Datadog、CodeRabbit、HackerSquadは緊急方針で中止し、使用済みとは報告しません。」

## Supabaseについて

クラウドAuth・Database・Storage・Realtime・完全なRLSは未接続・未完成です。ローカルmigration草案は既存の54322番ポート競合で検証できず、公開前に削除しました。別プロジェクトや別コンテナは確認・停止していません。
