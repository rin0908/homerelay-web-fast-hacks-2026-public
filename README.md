# HomeRelay

写真と声だけで家族向けの申し送りを作り、本人が確認した内容だけを次の人へ渡す、スマートフォン優先のWebアプリです。対象は招待されたご家族・ご親族・訪問ヘルパーです。合成データだけで動かしてください。

公開ソースは[rin0908/homerelay-web-fast-hacks-2026-public](https://github.com/rin0908/homerelay-web-fast-hacks-2026-public)です。公開前に到達可能なGit履歴の個人メールをGitHub noreplyへ置換し、旧SHAや秘密情報を含まない新規PUBLIC repositoryとして作成しました。作業PRは[#1](https://github.com/rin0908/homerelay-web-fast-hacks-2026-public/pull/1)で、`main`へはまだmergeしていません。

## すぐ動かす（合成デモ）

Node.js 22.9.0以降を用意し、リポジトリ直下で実行します。

```powershell
npm ci
npm run dev
```

- 家族画面: [http://localhost:3000](http://localhost:3000)
- 記録画面: [http://localhost:3000/record](http://localhost:3000/record)

本番相当のローカル起動は`npm run build`の後に`npm run start`です。

資格情報がない既定状態では、外部通信をしない`demo`モードです。写真→音声→合成AI下書き→本人確認→`次の人へ`→別タブ反映→`見ました`→`私がやります`→`できました`→`買います`→`買いました`まで動きます。

## demoとliveの分離

| モード | 設定 | 保存・同期 | 外部サービス表示 |
|---|---|---|---|
| 合成デモ | `HOMERELAY_DEMO_MODE=true`、`HOMERELAY_DATA_MODE=demo` | 同じブラウザのlocalStorage + BroadcastChannel | 合成下書き・合成関連候補と明記 |
| Supabase live | `HOMERELAY_DEMO_MODE=false`、`HOMERELAY_DATA_MODE=supabase` | Auth + Postgres + private Storage + Realtime | 設定済みのserver-only adapterだけ利用 |

liveで障害が起きても、暗黙にlocalStorageへ戻って共有成功とは表示しません。OpenAIの有料処理はSupabase liveの招待済みセッションからだけ実行され、失敗時は空の`手入力する`画面へ安全に切り替わります。合成下書きをlive成功として表示しません。

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

続いて、別browser contextを使うSupabase live E2Eを実行できます。下記のパスワードもprocess内だけに保持します。このsuiteは専用の合成下書きをbrowser内で返し、OpenAI、Qdrant、Neo4j、Datadogをprocess側でも無効化するため、vendor課金や外部残存データを発生させません。

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
| `acknowledge_entry` | 「見ました」を記録 | entry IDを現在世帯で照合 |
| `claim_entry` | 「私がやります」を記録 | entry IDを現在世帯で照合し、未引受だけ更新 |
| `complete_entry` | 「できました」を記録 | 現在世帯かつ引受者本人だけ更新 |
| `claim_needed_item` | 「買います」を記録 | item IDを現在世帯で照合し、未引受だけ更新 |
| `complete_needed_item` | 「買いました」を記録 | 現在世帯かつ購入担当者本人だけ更新 |

6件はすべて`public` schema、固定`search_path=''`、完全修飾した静的SQLで、動的SQLや入力をSQL構文として評価する経路はありません。EXECUTEは`postgres`（owner）、`authenticated`、`service_role`にあり、PUBLIC/anonにはありません。各関数が呼ぶ`private.current_member_id()`と`private.current_household_id()`が`auth.uid() IS NOT NULL`と`members.auth_user_id = auth.uid()`を確認し、対象行も現在世帯で照合します。クラウド試験では別世帯からID指定できる5 RPCをすべて拒否し、`share_handoff`は他世帯IDを受け取れない設計です。service-role/secret keyは一時Node.js検証プロセスだけで使い、browser bundle、`.env.local`、文書、Gitへ公開していません。このため6 WARNは意図した権限昇格境界としてschema変更なしで受容します。

Performance Advisorsの初回INFO 14件は、複合foreign keyのcovering index不足6件と、空DBで未使用と判定されたindex 8件でした。合成受入試験後は後者8件が消え、現在はunindexed foreign keyのINFO 6件です。データ0件のMVPで機能・安全性への影響はなく、今回はindexを追加しません。実データ量、代表query、`EXPLAIN (ANALYZE, BUFFERS)`を確認してから追加を判断する将来項目とします。

## 環境変数

browser-safeな通常設定は`.env.local`、server runtime secretはデプロイ先のsecret設定、検証用admin値は一時shell変数だけに置き、Git・チャット・画面共有へ貼らないでください。`.env.local`はGit対象外です。通常の変数名一覧は[.env.example](.env.example)にありますが、クラウドcleanup用secretはファイル保存を避けるため意図的に一時shellだけで渡します。

| 変数 | 用途 |
|---|---|
| `HOMERELAY_DEMO_MODE`, `HOMERELAY_DATA_MODE` | demo/liveを明示選択 |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ブラウザで使えるHomeRelay Supabase設定 |
| `OPENAI_API_KEY`, `OPENAI_PROJECT_ID` | server-only音声文字起こし・構造化下書きとHomeRelay専用Project固定 |
| `HOMERELAY_OPENAI_VERIFY*` | loopback限定・短い合成WAVによる明示opt-in live verifier |
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

1. 家族タブと記録タブで`/`を開く。
2. 記録タブで`カメラを開く`→自動表示されたプレビューで`撮影`→`この写真を使う`。
3. `声で話す`を押し、「昼食は半分ほど。水分を用意しました。トイレットペーパーが少ないです。」と話して停止する。
4. 下書きを確認・修正し、`これでOK`。この時点では家族タブへ出ない。
5. `次の人へ`を押し、家族タブへの反映を確認する。
6. `見ました`→`私がやります`→`できました`。
7. `買います`→`買いました`。
8. `合成候補（Qdrant未接続）`表示を見せ、live結果ではないと説明する。

### HTTPSスマートフォン + 別PC

同じHomeRelayクラウドSupabaseへ接続したHTTPSデプロイを両端末で開きます。iPhoneでは最初にSafariの共有ボタンから`ホーム画面に追加`を選び、以後はHomeRelayアイコンから起動します。これにより通常のSafari URLバーを表示せず、同じ画面内でカメラとマイクを使えます。初回だけiOSのカメラ／マイク許可は必要で、このOS表示は隠しません。PCは家族、iPhoneはヘルパーでログインし、上記と同じ導線を実施します。確認前の非共有と、`次の人へ`後のRealtime反映を実機で確認してください。

#### 2026-09-02 実機受入結果

保護されたPRIVATE Vercel Previewで、実iPhoneのHome Screen版を訪問ヘルパー、別Windows PCを家族として使用しました。固定`新しく伝える`CTAから1回の操作でカメラを開き、写真、音声、OpenAI live下書き、本人確認前の非共有、確認後のSupabase保存、WindowsへのRealtime反映、`見ました`→`私がやります`→`できました`、`買います`→`買いました`、Qdrant候補表示までを確認しました。Windowsの最新カードは10秒以内に表示され、5操作の主観的な反応は「普通（許容）」でした。

Windowsストップウォッチで、iPhoneの固定CTAタップからWindowsの`買いました`反映までを連続して計測し、60秒と56秒で2回成功しました。ログイン、Vercel保護通過、Home Screen追加、初回のOS権限許可は事前準備として計測外です。56秒の合成速度試験では、安全な写真と発話した必要品が意味的に一致していないため、写真・音声・共有の導線証拠ではありますが、写真内容と本文の一致を示す品質証拠には使用しません。

cleanup直前のserver-side read-backでは、最新entryの3対応と購入完了、Qdrantの最新handoff／必要品1件と別世帯0件、Neo4jの`done`／7 relationshipsと別世帯0件を確認しました。その後、固定台帳の合成fixtureだけを一度cleanupし、直後と2秒後の2回とも、Auth users、5 public tables、Storage objects、Qdrant fixture points、Neo4j fixture nodes／relationshipsがすべて0件でした。ローカルの3つの一時合成パスワードと一度限りログインQRも削除済みです。

この物理受入時点のローカル検証は、lint、typecheck、集中22/22 tests、全unit 56 files / 434 tests、synthetic E2E 16/16（live-only 2件はfixture cleanup後の再生成を避けるため意図的skip）、production build、privacy／reachable-history secret scan、production dependency audit 0件、`git diff --check`がPASSしました。後述するCodeRabbit対応後の最新HEADは別に再検証しており、この受入時のPreviewとは区別します。

締めの言葉: 「HomeRelayは監視ではありません。写真と声だけで、次の人へ温かくバトンを渡すWebアプリです。」

## 検証

```powershell
npm run verify:release
npm run verify:sponsors
npm run verify:supabase:cloud
```

2026-08-28の公開前最終検証では、lint、typecheck、cloud集中テスト47/47、全unit 42 files / 308 tests、production build、privacy audit、追加秘密情報検査、`git diff --check`がすべてPASSしました。privacy auditは公開候補160ファイル、到達可能なGit履歴、本番browser配信物37ファイルを検査し、credential pattern、private media、server-secret markerを検出していません。

### OpenAI API live検証（2026-08-30）

HomeRelay専用Projectへ`OPENAI_PROJECT_ID`で固定し、個人情報を含まない6.97秒の合成ja-JP WAVだけを使用しました。最初のroute試行は本文やvendor詳細を返さない安全な502で終了し、再試行前にProject表示使用額$0.00と組織残高$18.18を読み戻しました。SDKを`maxRetries=0`、`logLevel=off`、minimal reasoning、出力上限付きへ固定した次の1回で、`gpt-4o-mini-transcribe`の文字起こしと`gpt-5-mini`のstrict構造化下書きがend-to-end PASSしました。

Dashboardの最終集計は3 requests、588 input tokens、419 output tokens（合計1,007 tokens）です。組織残高は$18.18→$18.18、HomeRelay Projectの小数2桁表示使用額は$0.00→$0.00、$1 hard limitは不変でした。2026-08-30の公式単価と最終token内訳による安全側の上限見積もりは$0.0024未満ですが、Dashboardの未丸め実費は表示されないため「厳密に$0」とは記録しません。API key、response body、文字起こし本文、下書き本文はログへ出さず、一時WAVは削除後0件です。

本人確認前に`/api/entries`への保存・共有要求が発生しないphone/desktop E2Eと、API失敗が固定された短い502になり合成成功へ偽装されない集中テストもPASSしています。

通常のOpenAI routeはSupabase liveかつ有効な招待セッションを必須とします。UIは30秒で録音を自動停止し、routeは申告durationが30秒以内かつ実byteが2 MiB以内であることを検証します。音声本体からdurationを独立算出する検証ではないため、server側ではさらにメンバー3回／10分、世帯10回／10分、メンバー1件・世帯2件までの同時実行guardをAPI呼び出し前に適用します。このguardは単一runtime内の防御層であり、Projectの$1 hard limitを置き換えるものではありません。例外のlive verifierは非production、`127.0.0.1:3110`、明示opt-in、32文字以上の一時token、専用headerをすべて満たす場合だけ認証を迂回します。client timeoutはroute上限60秒より長い65秒で、1回のloopback requestだけを送り、昼食・水分・ティッシュの3事実を個別に検証します。

再実行は課金を伴うため、個人情報を含まない短い合成WAVだけで明示的に行います。2つのPowerShellで同じ一時tokenを安全に入力し、終了後に両processから削除してください。tokenと音声pathは`.env.local`へ残しません。

```powershell
# Terminal A: tokenは32文字以上。入力値は画面へ表示しません。
$secure = Read-Host "OpenAI verifier one-time token" -AsSecureString
$env:HOMERELAY_OPENAI_VERIFY_TOKEN = [System.Net.NetworkCredential]::new("", $secure).Password
$env:HOMERELAY_OPENAI_VERIFY = "true"
$env:HOMERELAY_DEMO_MODE = "true"
$env:HOMERELAY_DATA_MODE = "demo"
npm run dev:openai-verify
# 検証後にCtrl+Cで停止してから実行します。
Remove-Item Env:HOMERELAY_OPENAI_VERIFY_TOKEN, Env:HOMERELAY_OPENAI_VERIFY -ErrorAction SilentlyContinue
```

```powershell
# Terminal B: Terminal Aと同じtokenと、短い合成WAVの絶対pathを入力します。
$secure = Read-Host "OpenAI verifier one-time token" -AsSecureString
$env:HOMERELAY_OPENAI_VERIFY_TOKEN = [System.Net.NetworkCredential]::new("", $secure).Password
$env:HOMERELAY_OPENAI_VERIFY = "true"
$env:HOMERELAY_OPENAI_VERIFY_AUDIO = Read-Host "Synthetic WAV absolute path"
$env:HOMERELAY_OPENAI_VERIFY_URL = "http://127.0.0.1:3110"
npm run verify:openai
Remove-Item Env:HOMERELAY_OPENAI_VERIFY_TOKEN, Env:HOMERELAY_OPENAI_VERIFY_AUDIO, Env:HOMERELAY_OPENAI_VERIFY_URL, Env:HOMERELAY_OPENAI_VERIFY -ErrorAction SilentlyContinue
```

`verify:openai`は、明示opt-in・合成WAV・一時tokenがなければ外部通信せず終了コード1で失敗します。Qdrant、Neo4j、Datadogの資格情報なしverifierは安全に`SKIP`して終了コード0を返します。どちらもlive接続成功の証拠ではなく、`PASS`またはvendor受付結果を読み戻せた場合だけ使用済みと記録します。

同日の最新検証は、lint、typecheck、49 files / 374 unit tests、14 synthetic E2E（Supabase live-only 2件は意図的skip）、production build、`.env.local`の実秘密値を非表示で照合するprivacy audit、秘密情報検査、production dependency脆弱性0件、`git diff --check`がPASSしました。privacy auditは170公開候補ファイル、到達可能Git履歴、27 browser配信ファイルを検査しました。これ以前の連続デモ検証では、`見ました`→`私がやります`→`できました`→`買います`→`買いました`までphone 2回・desktop 2回の計4回を実行し、AI失敗→空の手入力→本人確認→明示共有もphone/desktopでPASSしています。

### iPhone導線と操作反応の改善（2026-09-01）

通常のSafariでURLバーが見える問題に対し、standalone manifest、Apple Web App metadata、HomeRelay専用アイコン、ホーム画面追加案内を実装しました。ホームの`カメラを開く`から背面カメラを一度だけ自動起動するため、記録画面で同じ開始ボタンをもう一度押す必要はありません。シャッター、撮り直し、`この写真を使う`、音声開始、本人確認は意図しない撮影・録音・共有を防ぐため維持します。

スマートフォンのホームには、履歴件数やスクロール位置に関係なく使える`新しく伝える`固定CTAを安全領域の上へ表示します。PCでは従来どおり右側の入力カードを表示し、固定CTAは表示しません。カメラ／マイクの許可はiOSが端末・Webアプリ単位で求める初回の安全確認であり、自動承認せず利用者本人が選択します。

対応・購入の5操作は、タップ時に短い状態表示とともに即時反映し、認証付きのguarded RPCを順序どおり一括送信します。送信中のRealtime表示は保留してSupabase正本を最後に読み戻し、失敗時は楽観表示を戻して警告します。別batchも直列送信し、画面離脱時はpending actionを`keepalive`でflushします。Neo4j派生graphには`買います`と`買いました`の両イベントを残し、アクセス権限は引き続きSupabaseだけで判定します。

このcheckpointではlint、typecheck、56 files / 434 unit tests、16 synthetic E2E（live-only 2件は意図的skip）、Next.js 16.3.3 production build、privacy audit、production dependency audit、`git diff --check`がPASSしました。privacy auditは190公開候補ファイル、到達可能Git履歴、41 browser配信ファイルを検査し、private media、credential pattern、runtime content log、server-secret markerを検出していません。この時点のPRIVATE Previewでもstandalone起動、固定CTA、即時操作、iPhone＋Windowsの中心導線を物理確認し、60秒と56秒の2回連続成功まで完了しました。

### CodeRabbit実レビュー（2026-09-02〜03）

新しいPUBLIC repositoryだけにCodeRabbitを接続し、PR #1の`b9e56a5813b0116d08eb88e992fede66c9c2f336`へ[手動full review](https://github.com/rin0908/homerelay-web-fast-hacks-2026-public/pull/1#pullrequestreview-5086311772)を実行しました。CodeRabbitは23件のactionable commentを返し、20件はコード／テスト／文書で修正、1件は既存の`afterEach`で保護済み、1件はSupabase専用E2Eのvendor隔離を弱めるため却下、1件は単一serverless runtime内のrate limitという既知の防御層として受容しました。続く`32db7d9…`への[増分review](https://github.com/rin0908/homerelay-web-fast-hacks-2026-public/pull/1#pullrequestreview-5088079735)ではactionable 4件とoutside-diff 1件を取得し、Node要件、live flag正規化、vendor read-back分類、遅延Auth test、action timeoutの5件をすべて修正しました。

`f996dc6…`ではさらに、遅延`Set-Cookie`と並行ログイン／ログアウトをHttpOnly session guard、server session fingerprint、共有Web Lockでfail closedにし、曖昧なaction応答後の依存batchを止めてSupabase正本のread-backでのみ解除するよう強化しました。同HEADへの[CodeRabbit最終増分review](https://github.com/rin0908/homerelay-web-fast-hacks-2026-public/pull/1#pullrequestreview-5090633444)は完了し、actionable 9件を取得しました。対応commit `76500b98f1f91ad3bab80c915aa73f90156538b3`で9件を修正し、その25ファイル差分のfollow-up reviewはactionable 0件でした。その後、`209f05a…`へのreviewで、認証確認不能時にdevice loginへ進める1件と、outside-diffの不正な`completedCount`を確定失敗として扱う問題を確認しました。両方をcommit `a4bb941226f095be236023b0e7a5bb5b7e1c2236`でfail closedに修正し、[8ファイル増分の再review](https://github.com/rin0908/homerelay-web-fast-hacks-2026-public/pull/1#issuecomment-5520259638)は`success`、actionable 0件で完了しました。Docstring Coverage 0% / 80%のpre-merge warning 1件は機能・安全性の指摘ではないスタイル指標として受容しています。最新コードはlint、typecheck、68 files / 590 unit tests、16 synthetic E2E（live-only 2件はcleanup済み外部fixtureを再作成しないため意図的skip）、Next.js 16.3.3 production build、privacy／secret監査、`git diff --check`に合格しています。PRはOPEN・未mergeです。

### 2026-09-03 現行runtimeの最終物理再試験

PRの試験前HEAD `5c5c869aa5f050967a7aa16edbfa956658b549e2`は、runtime commit `a4bb941226f095be236023b0e7a5bb5b7e1c2236`の直上にある4文書だけのcommitで、実行コード・設定・依存関係の差分は0件です。再利用したVercel Preview `https://homerelay-web-fast-hacks-2026-5z2pdu5ts-o9da23e-1271s-projects.vercel.app`はREADYで、immutable deployment metadataの`homerelayCommit`が`a4bb941…`、`homerelayBranch`が`codex/openai-live-verification`であることを確認しました。

この現行runtimeを、実iPhoneの訪問ヘルパー画面と別Windows PCの家族画面で2回連続試験しました。試験1は正確に60秒、試験2は56秒です。両方とも写真、音声、OpenAI live下書き、本人確認前の非共有、確認後のSupabase保存、WindowsへのRealtime反映、`見ました`→`私がやります`→`できました`、`買います`→`買いました`をエラーなしで完了しました。試験1の新カードは10秒以内に届き、初回のためQdrantは正常な「候補なし」でした。試験2は7秒以内に届き、Qdrantのlive検索結果として類似候補1件を表示しました。以前の`23138b0…`での60秒以内／42秒結果は履歴として保持しますが、今回の合格根拠には使用していません。

cleanup前のserver-side read-backでは、Supabaseに完了済みentry 2、購入済みneeded item 2、各entryの3操作を表すacknowledgement 6、private Storage object 2があり、別世帯entry／itemは0でした。Qdrantにはhandoff 2＋needed item 2の計4 pointsがあり、同世帯の類似候補1件、別世帯point／検索結果0を確認しました。Neo4jにはnode 8／relationship 24があり、完了handoff 2、購入済みitem 2、handoff action 6、purchase action 4、`ASSIGNED_TO` 2、`PURCHASE_ASSIGNEE` 2、別世帯handoff／item 0を確認しました。

その後、固定ledgerが指すHomeRelay合成fixtureだけを一度cleanupしました。cleanup直後と2秒後の検証器read-backに加え、独立した全体read-backを直後とさらに2秒後に行い、Supabase Auth、`households`、`members`、`entries`、`needed_items`、`acknowledgements`、Storage、Qdrant collection、Neo4j HomeRelay graphのnode／relationshipがすべて0件であることを確認しました。3つの一時合成パスワード、一度限りQR、fixture ledger、一時配備ファイルも削除済みです。

この証拠更新後の候補は、lint、typecheck、集中4ファイル／65 tests、全unit 68ファイル／590 tests、synthetic E2E 16件（live-only 2件は意図的skip）、Next.js 16.3.3 production build、215公開候補ファイル／到達可能Git履歴／43 browser配信ファイルのprivacy・secret監査、production dependency audit 0件、`git diff --check`に合格しました。

### Qdrant / Neo4j live検証（2026-08-30）

Qdrant Cloud Freeの`homerelay-qdrant`はHealthyです。collection bootstrap後、Cloud Inferenceによる類似申し送りと必要品の検索、別世帯filter、検証pointの削除と0件read-backがliveでPASSしました。

Neo4j AuraDB Freeの`homerelay-graph`はRunningです。5つのconstraintをread-backし、Home／foreignの2つの合成graphをparameterized writeした後、家族・親族・ヘルパー・申し送り・対応担当・購入担当の関係をread-backしました。Home filterにforeign graphが混ざらないことと、両世帯のnode／relationshipをcleanup後に各0件であることもliveでPASSしました。接続層は2026 Auraのinstance identifierをusername／databaseとして扱う形式に対応していますが、この更新ではその実値を文書・Gitへ記録していません。

Datadog verifierは固定の非個人tag付き合成success/failure countと処理時間だけを送る形へ強化済みです。AP1 Japanの新規登録では、異なる2つのメールアドレスで認証コードの送信と再送信を試しましたが、いずれもDatadog側の「不明なエラー」で失敗しました。API keyは作成・保存しておらず、live ingestionもUI read-backも未実行のため、Datadogは未接続・未使用です。同じ登録操作は繰り返さず、他の完成作業後に1回だけ再試行します。HackerSquadはbuilder loginまで成功しましたが、対象イベントはArchivedで、提出ボタンもproject導線もありません。project作成・提出は実行しておらず、使用済みとは扱いません。

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
- OpenAI API: **HomeRelay専用Projectへ実接続済み・live検証PASS**。server-onlyで`gpt-4o-mini-transcribe`による合成音声文字起こしと`gpt-5-mini`によるstrict構造化下書きを確認しました。本人確認前は保存・共有せず、失敗時は安全な502を返して合成結果へ偽装しません。
- Qdrant: **Qdrant Cloud Freeへ実接続済み・live検証PASS**。`homerelay-qdrant`のHealthy、bootstrap、Cloud Inferenceの類似申し送り／必要品、別世帯filter、検証point削除後0件を確認しました。
- Neo4j: **AuraDB Freeへ実接続済み・live検証PASS**。`homerelay-graph`のRunning、5 constraints、Home／foreign graphのparameterized write、関係read-back、Home filterでforeign 0件、両世帯cleanup後node／relationship各0件を確認しました。2026 Auraのusername／database形式にも対応済みです。
- Datadog: verifierとserver-only numeric metricsは実装済みですが、AP1 Japanの認証コード送信／再送信が2つの異なるメールでDatadog側の「不明なエラー」になりました。API key未作成・未保存、live未実行のため**未接続・未使用**です。同じ登録操作は繰り返さず、他工程後に1回だけ再試行します。
- CodeRabbit: 新しいPUBLIC HomeRelay repositoryだけに接続し、PR #1で実full reviewと増分reviewを完了したため**使用済み**です。初回23件、続くactionable 4件＋outside-diff 1件、さらに9件を分類・対応しました。`209f05a…`への追加reviewで確認した認証1件とoutside-diff action回復1件も`a4bb941…`で修正し、最新8ファイル増分reviewはactionable 0件です。Docstring Coverage warning 1件はactionable commentとは別のスタイル指標です。PRはOPEN・未mergeです。
- HackerSquad: builder loginは成功しましたが、対象イベントがArchivedで提出ボタン／project導線がなく、project作成・提出は未実行です。提出済み・使用済みとは扱いません。

詳細な目的、実装ファイル、検証、デモ箇所、必要資格情報は[SPONSOR_TOOL_EVIDENCE.md](SPONSOR_TOOL_EVIDENCE.md)にあります。

## 安全上の境界

- HomeRelay専用の独立プロジェクトです。
- 実在人物の情報を入れず、合成データだけを使用します。
- 家族共有の申し送り要約だけを扱い、事業者の公式記録を保存しません。
- 訪問看護、診断、服薬変更、医療判断、位置情報、監視機能は対象外です。
- 写真、音声、氏名、申し送り本文をDatadogへ送りません。
- server secretを`NEXT_PUBLIC_`変数、ブラウザbundle、Gitへ入れません。
