# HomeRelay

写真と声だけで家族向けの申し送りを作り、本人が確認した内容だけを次の人へ渡す、スマートフォン優先のWebアプリです。対象は招待されたご家族・ご親族・訪問ヘルパーです。合成データだけで動かしてください。

## すぐ動かす（合成デモ）

Node.js 22以降を用意し、リポジトリ直下で実行します。

```powershell
npm ci
npm run dev
```

- 家族画面: [http://localhost:3000](http://localhost:3000)
- 記録画面: [http://localhost:3000/record](http://localhost:3000/record)

本番相当のローカル起動は`npm run build`の後に`npm run start`です。

資格情報がない既定状態では、外部通信をしない`demo`モードです。写真→音声→合成AI下書き→本人確認→`次の人へ`→別タブ反映→`確認しました`→`私が対応します`→`対応しました`→`購入します`→`購入しました`まで動きます。

## demoとliveの分離

| モード | 設定 | 保存・同期 | 外部サービス表示 |
|---|---|---|---|
| 合成デモ | `HOMERELAY_DEMO_MODE=true`、`HOMERELAY_DATA_MODE=demo` | 同じブラウザのlocalStorage + BroadcastChannel | 合成下書き・合成関連候補と明記 |
| Supabase live | `HOMERELAY_DEMO_MODE=false`、`HOMERELAY_DATA_MODE=supabase` | Auth + Postgres + private Storage + Realtime | 設定済みのserver-only adapterだけ利用 |

liveで障害が起きても、暗黙にlocalStorageへ戻って共有成功とは表示しません。

## HomeRelayローカルSupabase

Dockerを起動してから、専用の554xxポート群で初期化します。

```powershell
npx supabase start
npx supabase db reset --local
npx supabase test db
```

`npx supabase status -o json`の`API_URL`と`PUBLISHABLE_KEY`を、Git管理外の`.env.local`へ設定します。管理用`SECRET_KEY`は通常アプリには不要で、`.env.local`へ保存しないでください。

```dotenv
HOMERELAY_DEMO_MODE=false
HOMERELAY_DATA_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=<local API_URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local PUBLISHABLE_KEY>
```

seedの合成ユーザーには、リポジトリ内で分からないランダムパスワードが入ります。手動デモ用パスワードは実行時だけ安全に設定します。

まず自動検証を実行します。これらのscriptはplain Node.jsで動き、`.env.local`を自動読込しないため、管理値は現在のPowerShell processへだけ設定します。各検証は予約済み合成アカウントのパスワードを別の一時ランダム値へ更新します。

```powershell
$status = npx supabase status -o json | ConvertFrom-Json
$env:HOMERELAY_TEST_SUPABASE_URL = $status.API_URL
$env:HOMERELAY_TEST_SUPABASE_PUBLISHABLE_KEY = $status.PUBLISHABLE_KEY
$env:HOMERELAY_TEST_SUPABASE_SECRET_KEY = $status.SECRET_KEY
npm run verify:supabase:local
npm run verify:supabase:realtime
```

続いて、別browser contextを使うlive E2Eを実行できます。下記のパスワードもprocess内だけに保持します。

```powershell
$env:HOMERELAY_DEMO_MODE = "false"
$env:HOMERELAY_DATA_MODE = "supabase"
$env:NEXT_PUBLIC_SUPABASE_URL = $status.API_URL
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $status.PUBLISHABLE_KEY
$env:HOMERELAY_E2E_LIVE = "true"
$env:HOMERELAY_E2E_SUPABASE_SECRET_KEY = $status.SECRET_KEY
$secure = Read-Host "一時E2Eパスワード（12文字以上）" -AsSecureString
$env:HOMERELAY_E2E_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
npm run test:e2e:live
```

最後に、手動デモで使うパスワードを設定します。自動検証後にこのprovisionを再実行してください。

```powershell
$env:HOMERELAY_LOCAL_SUPABASE_URL = $status.API_URL
$env:HOMERELAY_LOCAL_SUPABASE_SECRET_KEY = $status.SECRET_KEY
$secure = Read-Host "一時デモパスワード（英大/小文字・数字を含む12文字以上）" -AsSecureString
$env:HOMERELAY_LOCAL_DEMO_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
npm run supabase:provision:local
```

ログイン用の予約済み合成アドレスは`family-a@homerelay.test`、`helper-a@homerelay.test`、`relative-a@homerelay.test`です。別世帯拒否の検証専用は`family-b@homerelay.test`です。

## HomeRelay専用クラウドSupabase

HomeRelay専用プロジェクトへ実接続済みです。接続先はProject ID `czfmqaeqamepntpsakbv`、API URL `https://czfmqaeqamepntpsakbv.supabase.co`、東京リージョン `ap-northeast-1` です。migration `20260827114534_homerelay_core` は適用済みで、RLS有効なpublicテーブルは`households`、`members`、`entries`、`needed_items`、`acknowledgements`の5件、非公開bucketは`handoff-photos`、Realtime publication対象は`entries`、`needed_items`、`acknowledgements`の3件です。

HomeRelayは招待制です。2026-08-28にSupabase Dashboardの「Allow new users to sign up」だけをONからOFFへ変更し、公開Auth settingsで`disable_signup: false → true`を確認しました。メール確認必須は維持され、`mailer_autoconfirm=false`、画面上の「Confirm email」はONです。signup以外の公開Auth settingsを正規化したSHA-256は変更前後とも`e2308943ad6e80fd6f9b61d72cd13ab7f615194f037080b37db404c454a62318`で、manual linking OFF、anonymous sign-in OFF、email provider ONも不変です。CLI `config push`は使わず、URL、メール、schema、migration、bucket、Realtime、API keyは変更していません。

変更後のクラウド受入試験は、一般signup拒否、server-only admin `generateLink(type=invite)`による招待リンク生成と`verifyOtp(type=invite)`による消費、同世帯での共有・確認・対応引受・対応完了・購入引受・購入完了、別世帯SELECTと5つのID指定guarded RPC拒否、非公開StorageのSELECT・INSERT・UPDATE・DELETE拒否、同世帯Realtime受信、別世帯非配信をすべてPASSしました。cleanup後に検証器とは別のSQL読取で、Authユーザー、`households`、`members`、`entries`、`needed_items`、`acknowledgements`、`handoff-photos` objectがすべて0件であることを確認しています。

再構築時の正式手順は次のとおりです。

1. Supabase CLIで新規プロジェクトへ`link`する。
2. `npx supabase db push`で`supabase/migrations/`だけを反映する。`supabase/seed.sql`はローカル専用なのでクラウドへ投入しない。
3. Authの一般signupを無効にし、招待された合成デモ用アカウントだけをserver-only管理経路で作成する。
4. `households`と`members`へ、そのAuth UUIDに対応する合成membershipを登録する。
5. 公開URLとpublishable keyだけをアプリへ設定する。secret/service-role keyをブラウザへ渡さない。
6. 下記のcloud verifierで、同世帯の正例と別世帯のData API・RPC・Storage・Realtime拒否を確認する。

クラウド検証は明示opt-inが必要で、URLを上記Project IDへ固定し、HTTPS以外、loopback、別Project、`.test`以外のメールを接続前に拒否します。通常クライアントはpublishable keyだけを使います。検証物を必ず回収するためのsecret keyはNode.js検証プロセス内の管理クライアントだけが使用し、browser、`.env.local`、ログ、文書、Gitへ渡しません。値は`.env.local`から自動読込されません。

```powershell
$env:HOMERELAY_CLOUD_SUPABASE_VERIFY = "true"
$env:HOMERELAY_CLOUD_SUPABASE_URL = "https://czfmqaeqamepntpsakbv.supabase.co"
$env:HOMERELAY_CLOUD_SUPABASE_PUBLISHABLE_KEY = "<publishable key>"
$secure = Read-Host "server-only cleanup key" -AsSecureString
$env:HOMERELAY_CLOUD_SUPABASE_SECRET_KEY = [System.Net.NetworkCredential]::new("", $secure).Password
$env:HOMERELAY_CLOUD_FAMILY_EMAIL = "<synthetic family email>"
$secure = Read-Host "family password" -AsSecureString
$env:HOMERELAY_CLOUD_FAMILY_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
$env:HOMERELAY_CLOUD_HELPER_EMAIL = "<synthetic helper email>"
$secure = Read-Host "helper password" -AsSecureString
$env:HOMERELAY_CLOUD_HELPER_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
$env:HOMERELAY_CLOUD_FOREIGN_FAMILY_EMAIL = "<other synthetic household email>"
$secure = Read-Host "other household password" -AsSecureString
$env:HOMERELAY_CLOUD_FOREIGN_FAMILY_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
npm run verify:supabase:cloud
```

このverifierは開始時にAuth 0・対象publicテーブル5件が各0行・Storage 0を確認し、指定された相互に異なる`.test`ユーザーと既知UUIDの合成データだけを作成します。一般signup拒否に加え、メールを送信しないserver-onlyのadmin invite-linkを生成し、そのhashed tokenを招待として実際に消費できることまで確認します。cleanupはStorage、子テーブルから親テーブルの順のDatabase、Authの順で各SDK結果を確認し、即時確認に加えて遅延反映を検出する再確認も行います。終了時に0件でない場合はPASSにしません。foreign INSERTが予想外に成功した場合や応答が不明な場合も、管理クライアントが既知のpath／IDだけを回収します。一般の認可negative probeで401を扱うのは直前にAuth userとmembershipを再検証できた合成sessionに限りますが、別世帯guarded RPCは403またはSQLSTATE `42501`だけを拒否証拠とし、401はPASSにしません。429、5xx、timeout、通信失敗も認可PASSにしません。

Data APIの直接INSERT／UPDATE拒否は、現行migrationではauthenticatedへのtable write GRANTがないため`42501`で拒否される権限境界の試験です。publicテーブルの世帯別writeはguarded RPC内のmembership確認で拒否し、Storageの世帯別INSERT／UPDATE／DELETEはRLS policyそのものを試験しています。直接write拒否をpublicテーブルのwrite RLS試験とは表現しません。

Supabase Security AdvisorsのWARN 6件は、認証済みユーザーに意図的に公開した次の`SECURITY DEFINER` RPCに対するlint `0029`です。

| RPC | 目的 | 世帯・担当境界 |
|---|---|---|
| `share_handoff` | 本人確認済み申し送りと必要品を冪等・一括作成 | 世帯IDを入力にせず認証membershipから導出。写真pathも同じ世帯/memberへ固定 |
| `acknowledge_entry` | 「確認しました」を記録 | entry IDを現在世帯で照合 |
| `claim_entry` | 「私が対応します」を記録 | entry IDを現在世帯で照合し、未引受だけ更新 |
| `complete_entry` | 「対応しました」を記録 | 現在世帯かつ引受者本人だけ更新 |
| `claim_needed_item` | 「購入します」を記録 | item IDを現在世帯で照合し、未引受だけ更新 |
| `complete_needed_item` | 「購入しました」を記録 | 現在世帯かつ購入担当者本人だけ更新 |

6件はすべて`public` schema、固定`search_path=''`、完全修飾した静的SQLで、動的SQLや入力をSQL構文として評価する経路はありません。EXECUTEは`postgres`（owner）、`authenticated`、`service_role`にあり、PUBLIC/anonにはありません。各関数が呼ぶ`private.current_member_id()`と`private.current_household_id()`が`auth.uid() IS NOT NULL`と`members.auth_user_id = auth.uid()`を確認し、対象行も現在世帯で照合します。クラウド試験では別世帯からID指定できる5 RPCをすべて拒否し、`share_handoff`は他世帯IDを受け取れない設計です。service-role/secret keyは一時Node.js検証プロセスだけで使い、browser bundle、`.env.local`、文書、Gitへ公開していません。このため6 WARNは意図した権限昇格境界としてschema変更なしで受容します。

Performance Advisorsの初回INFO 14件は、複合foreign keyのcovering index不足6件と、空DBで未使用と判定されたindex 8件でした。合成受入試験後は後者8件が消え、現在はunindexed foreign keyのINFO 6件です。データ0件のMVPで機能・安全性への影響はなく、今回はindexを追加しません。実データ量、代表query、`EXPLAIN (ANALYZE, BUFFERS)`を確認してから追加を判断する将来項目とします。

## 環境変数

browser-safeな通常設定は`.env.local`、server runtime secretはデプロイ先のsecret設定、検証用admin値は一時shell変数だけに置き、Git・チャット・画面共有へ貼らないでください。`.env.local`はGit対象外です。通常の変数名一覧は[.env.example](.env.example)にありますが、クラウドcleanup用secretはファイル保存を避けるため意図的に一時shellだけで渡します。

| 変数 | 用途 |
|---|---|
| `HOMERELAY_DEMO_MODE`, `HOMERELAY_DATA_MODE` | demo/liveを明示選択 |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ブラウザで使えるHomeRelay Supabase設定 |
| `OPENAI_API_KEY` | server-only音声文字起こし・構造化下書き |
| `QDRANT_URL`, `QDRANT_API_KEY` | server-only類似申し送り・重複候補検索 |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | server-only関係グラフ |
| `DD_SITE`, `DD_API_KEY` | 数値のみのDatadog custom metrics |
| `HOMERELAY_LOCAL_*`, `HOMERELAY_TEST_*`, `HOMERELAY_E2E_*` | loopback限定のprovision・検証に使う一時shell値 |
| `HOMERELAY_CLOUD_*` | hosted環境の明示opt-in検証に使う一時shell値 |

Hosted Supabase verifierでは、上記とは別に次を一時環境変数として設定します。

```text
HOMERELAY_CLOUD_SUPABASE_VERIFY=true
HOMERELAY_CLOUD_SUPABASE_URL
HOMERELAY_CLOUD_SUPABASE_PUBLISHABLE_KEY
HOMERELAY_CLOUD_SUPABASE_SECRET_KEY (server-only process; browser/fileへ保存しない)
HOMERELAY_CLOUD_FAMILY_EMAIL / HOMERELAY_CLOUD_FAMILY_PASSWORD
HOMERELAY_CLOUD_HELPER_EMAIL / HOMERELAY_CLOUD_HELPER_PASSWORD
HOMERELAY_CLOUD_FOREIGN_FAMILY_EMAIL / HOMERELAY_CLOUD_FOREIGN_FAMILY_PASSWORD
```

## 60秒デモ

### 合成・同一PC

1. 家族タブで`/`、記録タブで`/record`を開く。
2. `写真を撮る`→撮影→`この写真を使う`。
3. `声で話す`を押し、「昼食は半分ほど。水分を用意しました。トイレットペーパーが少ないです。」と話して停止する。
4. 下書きを確認・修正し、`これでOK`。この時点では家族タブへ出ない。
5. `次の人へ`を押し、家族タブへの反映を確認する。
6. `確認しました`→`私が対応します`→`対応しました`。
7. `購入します`→`購入しました`。
8. `合成候補（Qdrant未接続）`表示を見せ、live結果ではないと説明する。

### HTTPSスマートフォン + 別PC

同じHomeRelayクラウドSupabaseへ接続したHTTPSデプロイを両端末で開きます。PCは家族、スマートフォンはヘルパーでログインし、上記と同じ導線を実施します。背面カメラとマイクの許可、確認前の非共有、`次の人へ`後のRealtime反映を実機で確認してください。

締めの言葉: 「HomeRelayは監視ではありません。写真と声だけで、次の人へ温かくバトンを渡すWebアプリです。」

## 検証

```powershell
npm run verify:release
npm run verify:sponsors
npm run verify:supabase:cloud
```

2026-08-28の公開前最終検証では、lint、typecheck、cloud集中テスト47/47、全unit 42 files / 308 tests、production build、privacy audit、追加秘密情報検査、`git diff --check`がすべてPASSしました。privacy auditは公開候補160ファイル、到達可能なGit履歴、本番browser配信物37ファイルを検査し、credential pattern、private media、server-secret markerを検出していません。

資格情報がないlive verifierは、安全に`SKIP`して終了コード0を返します。`SKIP`は接続成功の証拠ではありません。live使用済みと記録できるのは、各commandが`PASS`またはvendor受付結果を明示し、`SKIP`がない場合だけです。

ローカルSupabaseを起動した状態では、pgTAP、Auth/Data/Storage/RLS、Realtimeを追加確認します。

```powershell
npx supabase test db
npx supabase db lint --local --level warning
npm run verify:supabase:local
npm run verify:supabase:realtime
npm run test:e2e:live
```

loopback検証に必要な`HOMERELAY_TEST_*`と`HOMERELAY_E2E_*`は、[HomeRelayローカルSupabase](#homerelayローカルsupabase)の例どおり現在のprocessへ設定してください。`npm run audit:privacy`は、公開候補ファイル、到達可能なGit履歴、合成画像の固定hash、本番browser bundle/HTML/RSCを検査します。

自動local verifierやlive E2Eは合成アカウントのパスワードを更新するため、手動デモを行う場合はすべての自動検証後に`npm run supabase:provision:local`を最後に再実行してください。

## 外部連携の状態

- OpenAI Codex: 要件整理、実装、検証に使用済み。
- Supabase: 専用ローカル環境に加え、HomeRelayクラウド`czfmqaeqamepntpsakbv`（東京）へ実接続済み。招待制で一般signup無効、メール確認必須を維持。管理者invite-linkの生成・消費、RLS 5表、非公開Storage、Realtime 3表、同世帯5操作の正例、別世帯拒否、厳格cleanupを確認し、試験後はAuth 0・全public表0行・Storage 0。Security WARN 6は上記安全設計として受容、Performance INFO 6は将来のquery plan確認事項。
- OpenAI API: server-only adapterとschema検証を実装済み。資格情報未提供でlive未接続、専用live verifierは未実装です。live処理失敗時は合成結果へ偽装せず安全なエラーを返します。
- Qdrant、Neo4j、Datadog: server-only adapter、非blockingまたは明示的な利用不能状態、live verifierを実装済み。資格情報未提供のためlive未接続。
- CodeRabbit: `.coderabbit.yaml`を実装済み。GitHub App/PRレビュー未実施なので使用済みとは扱わない。
- HackerSquad: 認証済みの当日環境を確認できず未接続。

詳細な目的、実装ファイル、検証、デモ箇所、必要資格情報は[SPONSOR_TOOL_EVIDENCE.md](SPONSOR_TOOL_EVIDENCE.md)にあります。

## 安全上の境界

- HomeRelay専用の独立プロジェクトです。
- 実在人物の情報を入れず、合成データだけを使用します。
- 家族共有の申し送り要約だけを扱い、事業者の公式記録を保存しません。
- 訪問看護、診断、服薬変更、医療判断、位置情報、監視機能は対象外です。
- 写真、音声、氏名、申し送り本文をDatadogへ送りません。
- server secretを`NEXT_PUBLIC_`変数、ブラウザbundle、Gitへ入れません。
