<!--
  GitHub About section (repo publishing 用のメタ情報):

  Description:
    Cross-platform Mei Himari (冥鳴ひまり) voice notifications for Claude Code and Codex CLI. Works on macOS and Windows/WSL2, with optional VOICEVOX realtime synthesis.

  Topics:
    claude-code, codex-cli, voicevox, mei-himari, himari, hooks, notifications, nodejs, wsl2, macos
-->

# himari-code-notify

> Claude Code / OpenAI Codex CLI の作業が終わったら、**冥鳴ひまりの声で知らせてくれる** 通知 hook。
> API キー不要、音声ファイル同梱で即使える。

`VOICEVOX:冥鳴ひまり` のボイスで「作業が完了したわ。」「確認が必要よ。」などを再生し、同時にデスクトップ通知を出します。長時間のビルドや LLM 生成中に別作業していても、完了に気づけます。

> 本リポジトリは [zundamon-code-notify](https://github.com/) からの fork です。VOICEVOX キャラクターを「ずんだもん (speaker 3)」から「冥鳴ひまり (speaker 14)」に差し替えています。**環境変数名は上流互換のため `ZUNDAMON_*` のまま維持**しています (詳細は下記「環境変数リファレンス」参照)。

---

## 特徴

- **ワンスクリプトで両対応** — Claude Code の hooks と OpenAI Codex CLI の hooks、両方から同じ `notify.mjs` を呼ぶだけ。
- **macOS / Windows (WSL2) / Linux 対応** — OS 判定は内部で自動。Linux は experimental support。
- **依存ゼロ** — Node.js 標準モジュールだけ。外部 npm パッケージも API キーも不要。
- **2 つの音声モード** — 同梱 WAV ですぐ鳴らせるし、VOICEVOX が起動していればリアルタイム合成にも切り替えられる。
- **カスタマイズ可能** — `~/.config/himari-code-notify/phrases.json` でフレーズと話者を差し替えられる。
- **規約遵守フレンドリー** — VOICEVOX / 冥鳴ひまりの利用規約への案内と注意書きを同梱。

---

## 動作環境

| 種別 | 対応状況 |
|---|---|
| OS | macOS / Windows 11 + WSL2 / Linux (experimental) |
| ランタイム | Node.js 18 以降 (LTS 推奨) |
| 対象ツール | Claude Code / OpenAI Codex CLI |
| 音源 | 同梱 WAV / VOICEVOX リアルタイム合成 (オプション) |

---

## ディレクトリ構成

```
himari-code-notify/
├── .claude/
│   ├── settings.json            # Claude Code 用 hook 設定サンプル
│   └── hooks/
│       └── notify.mjs           # 本体スクリプト (両ツール共通)
├── examples/
│   └── codex-hooks-config.yaml  # Codex CLI 用設定サンプル
├── scripts/
│   ├── generate-voices.sh       # VOICEVOX で assets/*.wav を事前生成
│   ├── setup.sh                 # 初期セットアップ支援
│   └── test.mjs                 # notify.mjs の簡易テストランナー
├── assets/
│   ├── done.wav                 # Stop: 作業完了
│   ├── attention.wav            # Notification: 確認要求
│   └── subagent_done.wav        # SubagentStop: サブタスク完了
├── README.md
├── THIRD_PARTY_NOTICES.md
├── LICENSE
└── .gitignore
```

ユーザー側で追加できる任意ファイル:

```
~/.config/himari-code-notify/
└── phrases.json                 # フレーズ / speakerId のカスタマイズ (任意)
```

---

## セットアップ

### 共通: Node.js を入れる

[Node.js 公式サイト](https://nodejs.org/) から LTS をインストールしておいてください (18 以上推奨)。

```bash
node -v   # v18.x 以上になっていれば OK
```

### macOS の場合

```bash
# 1. リポジトリをクローン
git clone https://github.com/<your-account>/himari-code-notify.git
cd himari-code-notify

# 2. セットアップスクリプトを実行 (権限付与 / 動作確認)
bash scripts/setup.sh

# 3. 音声テスト
ZUNDAMON_DEBUG=1 node .claude/hooks/notify.mjs Stop
```

初回の通知時に、macOS から「"osascript" が通知を送信しようとしています」と確認が出ます。**システム設定 > 通知 > スクリプトエディタ (or osascript)** で通知を許可してください。

### Windows + WSL2 の場合

前提:
- Windows 11 (Windows 10 でもおそらく動作)
- WSL2 + 任意の Linux ディストリビューション (Ubuntu 等)
- Windows 側から `powershell.exe` が呼べること (既定で PATH に入っています)

```bash
# WSL2 のシェル内で
git clone https://github.com/<your-account>/himari-code-notify.git
cd himari-code-notify

bash scripts/setup.sh

ZUNDAMON_DEBUG=1 node .claude/hooks/notify.mjs Stop
```

WSL から `powershell.exe` を経由して Windows 側で再生・通知します。`wslpath` で自動的にパス変換するので、音声ファイルは WSL 側 (`/home/<user>/...`) に置いたままで OK です。

---

## Claude Code への hook 設定方法

本リポジトリ直下 (= `himari-code-notify/`) で Claude Code を起動するなら、同梱の `.claude/settings.json` が自動で読み込まれてそのまま動きます。

別プロジェクトから呼びたい場合は、そのプロジェクトの `.claude/settings.json` に次を追記してください (パスは実際の場所に置き換える):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs Stop"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs Notification"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs SubagentStop"
          }
        ]
      }
    ],
    "UserApproval": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs UserApproval"
          }
        ]
      }
    ]
  }
}
```

各イベントの意味:

| イベント | 音声 | 意味 |
|---|---|---|
| `Stop` | `assets/done.wav` | エージェントの応答が完了した |
| `Notification` | `assets/attention.wav` | ユーザーへの確認が必要になった (権限許可など) |
| `SubagentStop` | `assets/subagent_done.wav` | サブエージェントが完了した |
| `UserApproval` | (なし・論理イベント) | ユーザー許可が必要 (リアルタイム合成モード時のみ「許可が必要よ。」が鳴る) |

---

## Codex CLI への hook 設定方法

`examples/codex-hooks-config.yaml` にサンプルを用意しています。Codex CLI の設定ファイル (`~/.codex/config.toml` など) に下記のように追記してください (パスは実環境に合わせる):

```toml
[hooks.on_task_complete]
command = "node"
args = ["/absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs", "Stop"]

[hooks.on_attention_required]
command = "node"
args = ["/absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs", "Notification"]

[hooks.on_subagent_complete]
command = "node"
args = ["/absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs", "SubagentStop"]

[hooks.on_user_approval]
command = "node"
args = ["/absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs", "UserApproval"]
```

Codex CLI が単一 `notify` オプションしか持たない古いバージョンでは、シェル経由で呼び出してください:

```toml
notify = ["bash", "-c", "node /absolute/path/to/himari-code-notify/.claude/hooks/notify.mjs Stop"]
```

設定キーの正確な名前は、利用している Codex CLI のバージョンのドキュメントを必ず確認してください。

---

## 音声ファイルの差し替え

`assets/` 以下の WAV ファイルを置き換えるだけです。

```
assets/done.wav             ← Stop イベント用
assets/attention.wav        ← Notification イベント用
assets/subagent_done.wav    ← SubagentStop イベント用
```

ファイル名を変えず、WAV 形式で上書きすれば OK です。再生は macOS なら `afplay`、Windows/WSL なら `System.Media.SoundPlayer` を使うので、どちらも WAV (PCM) が安全です。

音声ファイルを別ディレクトリに置きたい場合は、環境変数 `ZUNDAMON_ASSETS_DIR` で上書きできます:

```bash
export ZUNDAMON_ASSETS_DIR=/path/to/my/voices
```

---

## リアルタイム合成モード (VOICEVOX 連携)

同梱 WAV を差し替える代わりに、VOICEVOX エンジンを起動しておいて **話すたびに合成** することもできます。フレーズを変えたい・複数種類のフレーズをランダムにしたい、などの拡張がしやすくなります。

### 使い方

1. [VOICEVOX 公式サイト](https://voicevox.hiroshiba.jp/) から VOICEVOX エディタ or 単体エンジンをインストールして起動 (デフォルト: `http://127.0.0.1:50021`)
2. `ZUNDAMON_USE_VOICEVOX=1` を付けて Claude Code / Codex CLI から hook を走らせる

```bash
ZUNDAMON_USE_VOICEVOX=1 ZUNDAMON_DEBUG=1 node .claude/hooks/notify.mjs Stop
```

Claude Code の `.claude/settings.json` からリアルタイム合成モードで呼び出す場合は、`env` で渡すか shell でラップします:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "ZUNDAMON_USE_VOICEVOX=1 node \"$CLAUDE_PROJECT_DIR/.claude/hooks/notify.mjs\" Stop"
          }
        ]
      }
    ]
  }
}
```

### 仕組み

- hook 起動時にローカル VOICEVOX エンジンへ `POST /audio_query` → `POST /synthesis` を投げて、生成された WAV を `os.tmpdir()` 以下の一時ファイルに書き出します。
- その一時ファイルを OS 別の再生コマンドで再生し、終わったら削除します。
- 再生テキスト (フレーズ) はイベントごとに決まっていて、`phrases.json` で上書き可能です。

### VOICEVOX が起動していないとき

リアルタイム合成モードを有効にしていても、VOICEVOX エンジンへの接続に失敗した場合は **自動的に同梱 WAV (`assets/*.wav`) にフォールバック** します。通知は常に出るので「VOICEVOX を落としたら何も鳴らない」ということは起きません。

`ZUNDAMON_DEBUG=1` を付けて実行すると、フォールバックの理由が stderr に出ます。

```
[himari-notify] VOICEVOX synth failed, falling back to bundled assets: connect ECONNREFUSED 127.0.0.1:50021
[himari-notify] platform=windows audio=C:\...\assets\done.wav
```

---

## フレーズ・話者のカスタマイズ (phrases.json)

`~/.config/himari-code-notify/phrases.json` を置くと、リアルタイム合成のテキスト・同梱 WAV 併用時の通知文・VOICEVOX 話者 ID を上書きできます。ファイルがなければ既定値が使われます。

ユーザーの許可が必要なとき用のイベント `UserApproval` も使えます (同梱 WAV は持たない論理イベントで、リアルタイム合成モード時に「許可が必要よ。」が鳴ります)。

### サンプル

```json
{
  "speakerId": 14,
  "stop": "作業が完了したわ。",
  "notification": "確認が必要よ。",
  "subagentStop": "サブタスクが完了したわ。",
  "userApproval": "許可が必要よ。"
}
```

| キー | 型 | 既定値 | 説明 |
|---|---|---|---|
| `speakerId` | number | `14` | VOICEVOX の話者 ID (14 = 冥鳴ひまり ノーマル) |
| `stop` | string | `作業が完了したわ。` | `Stop` イベントのフレーズ |
| `notification` | string | `確認が必要よ。` | `Notification` イベントのフレーズ |
| `subagentStop` | string | `サブタスクが完了したわ。` | `SubagentStop` イベントのフレーズ |
| `userApproval` | string | `許可が必要よ。` | `UserApproval` イベントのフレーズ (論理イベント) |

### 優先順位

- **フレーズ**: `phrases.json` のキー > デフォルト
- **話者 ID**: `phrases.json.speakerId` > `ZUNDAMON_SPEAKER_ID` 環境変数 > デフォルト (`14`)

### 話者 ID の確認方法

VOICEVOX エンジン起動中に下記で話者一覧を取得できます。

```bash
curl http://127.0.0.1:50021/speakers | jq '.[] | {name: .name, styles: .styles}'
```

冥鳴ひまりは現在 1 スタイルのみ:

| 話者 / スタイル | speakerId |
|---|---|
| 冥鳴ひまり (ノーマル) | 14 |

他のキャラクターに切り替えたい場合は VOICEVOX `/speakers` API で利用可能な ID を確認してください。

### 壊れた phrases.json のとき

JSON パースに失敗した場合は stderr に警告を出しつつ、デフォルト値を使って処理を続行します。hook が失敗して Claude Code が止まることはありません。

```
[himari-notify] WARN: failed to parse user config (~/.config/.../phrases.json): Unexpected token ... using defaults.
```

---

## Linux (experimental)

Linux ネイティブは実験的に対応しています。

- **再生**: `paplay` (PulseAudio/PipeWire) → `aplay` (ALSA) の順に試し、見つかったものを使います。
- **通知**: `notify-send` (libnotify) を使います。

必要なパッケージ (Debian/Ubuntu 例):

```bash
sudo apt install pulseaudio-utils libnotify-bin   # or: alsa-utils
```

どちらのコマンドも見つからない場合はデバッグログに警告を出すだけで、hook は `exit 0` で終わります (Claude Code を止めません)。

> ⚠ Linux サポートは experimental です。ウィンドウマネージャや DE の構成、オーディオスタック、ディストリビューションによっては動作しないことがあります。再現手順と環境情報を添えて issue を立ててくれると助かります。

---

## 環境変数リファレンス

> **重要**: 環境変数名は上流 (`zundamon-code-notify`) からの移行容易性と互換性のため `ZUNDAMON_*` プレフィクスをそのまま維持しています。値の意味と挙動は本リポジトリ向けに動きますが、既存の上流ユーザーが慣れた変数名で使えるようにしています。

| 環境変数 | 効果 |
|---|---|
| `ZUNDAMON_USE_VOICEVOX` | `1` にするとリアルタイム合成モード。エンジンが落ちていれば自動で同梱 WAV にフォールバックします。 |
| `ZUNDAMON_VOICEVOX_HOST` | VOICEVOX エンジンのホスト (既定 `http://127.0.0.1:50021`)。Docker 等に置くとき用。 |
| `ZUNDAMON_SPEAKER_ID` | `phrases.json` が無い場合の話者 ID 上書き用。冥鳴ひまり以外を試すときに使えます (例: `14` 以外)。 |
| `ZUNDAMON_ASSETS_DIR` | 同梱 WAV の探索先を別ディレクトリに切り替えます。 |
| `ZUNDAMON_DEBUG` | `1` にすると実行経路・OS 判定・VOICEVOX リクエストの詳細を stderr に出します。 |
| `ZUNDAMON_DRY_RUN` | `1` にすると実際の再生/通知をスキップします (主にテスト用)。 |

---

## テスト

`scripts/test.mjs` に簡易テストランナーを同梱しています。外部依存なし、`ZUNDAMON_DRY_RUN=1` で実際の音/通知は出さずにロジックだけ回します。

```bash
node scripts/test.mjs
```

カバーしているケース:

- デフォルト設定で各イベント (Stop / Notification / SubagentStop / UserApproval) が `exit 0` で終わる
- 未知のイベントを渡しても `Stop` にフォールバックして `exit 0`
- `ZUNDAMON_USE_VOICEVOX=1` + エンジンダウンでもフォールバックして `exit 0`
- `ZUNDAMON_USE_VOICEVOX=1` + エンジン起動中ならリアルタイム合成で一時 WAV が生成・削除される (VOICEVOX 起動時のみ実行)
- `phrases.json` あり/なしでフレーズと `speakerId` が切り替わる
- `phrases.json` が壊れていても警告を出してデフォルトで動く
- `ZUNDAMON_SPEAKER_ID` が `phrases.json` で上書きされる優先順位
- UserApproval が論理イベントとして同梱 WAV なしでも `exit 0`
- stdin が空でも hook が落ちない

---

## VOICEVOX で音声を自分で生成する

同梱の `scripts/generate-voices.sh` を使えば、ローカルの VOICEVOX エンジンから直接 WAV を生成できます。

```bash
# 1. VOICEVOX を起動 (エディタ or 単体エンジン)
#    デフォルトポート: 50021

# 2. スクリプト実行
bash scripts/generate-voices.sh

# 3. assets/*.wav が上書きされる
```

スピーカーやフレーズを変えたい場合は環境変数で上書きできます:

```bash
SPEAKER_ID=14 \
PHRASE_DONE="お疲れさまやで" \
PHRASE_ATTENTION="ちょっと来てちょうだい" \
PHRASE_SUBAGENT="下請けも終わったわ" \
bash scripts/generate-voices.sh
```

スピーカー ID の一覧は VOICEVOX エンジン起動中に `http://127.0.0.1:50021/speakers` から取得できます。

> ⚠ **重要**: VOICEVOX エンジン本体は本リポジトリには同梱していません。別途 [VOICEVOX 公式](https://voicevox.hiroshiba.jp/) から入手してください。生成した音声の利用は VOICEVOX 利用規約と、冥鳴ひまり利用規約に従ってください。詳しくは [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照。

---

## よくあるトラブルと対処法

### macOS: 通知が出ない

- **システム設定 > 通知** を開き、`スクリプトエディタ` または `osascript` の通知が「許可」になっているか確認してください。
- 初回実行時に出る許可ダイアログを取りこぼしている可能性があります。その場合、一度設定で削除してから再度 hook を発火させてください。

### macOS: 音が鳴らない

- `assets/done.wav` などが空ファイル (0 byte プレースホルダー) のままの可能性があります。`bash scripts/generate-voices.sh` で生成するか、ご自身の WAV を配置してください。
- `afplay assets/done.wav` を直接叩くと原因を切り分けできます。

### Windows: PowerShell の実行ポリシーで怒られる

`notify.mjs` は `powershell.exe -NoProfile -Command "<inline>"` を叩くだけで、外部 ps1 ファイルを読み込んでいないため、通常は実行ポリシーに抵触しません。それでも `UnauthorizedAccess` などが出る場合は、PowerShell を管理者権限で開いて次を実行してください:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### WSL: powershell.exe が見つからない

Windows 側の `System32\WindowsPowerShell\v1.0` が WSL の `PATH` に含まれていないケースがあります。`.bashrc` などで明示的に追加してください:

```bash
export PATH="$PATH:/mnt/c/Windows/System32/WindowsPowerShell/v1.0"
```

### WSL: wslpath が存在しない

WSL1 では `wslpath` が使えない、あるいは古い構成だと動作が異なる場合があります。本リポジトリは WSL2 前提です。WSL2 へ移行するか、環境変数 `ZUNDAMON_ASSETS_DIR` に **Windows 形式のパス (`C:\...`)** を設定する回避策が使えます。

### Linux: 音が鳴らない / 通知が出ない (experimental)

`ZUNDAMON_DEBUG=1` を付けて実行し、どのコマンドが無かったかを確認してください。`paplay` / `aplay` / `notify-send` が全滅している場合はパッケージを追加してください:

```bash
sudo apt install pulseaudio-utils libnotify-bin   # or: alsa-utils
```

SSH 越しで X / Wayland セッションが無い場合は、そもそも通知を出せないので注意してください (そのときもスクリプトは `exit 0` で終わります)。

### VOICEVOX: リアルタイム合成が効かない

- `curl http://127.0.0.1:50021/version` でバージョンが返ることを確認してください。返ってこない場合はエンジンが起動していません。
- `ZUNDAMON_DEBUG=1 ZUNDAMON_USE_VOICEVOX=1 node .claude/hooks/notify.mjs Stop` を叩くと、フォールバック理由が stderr に出ます。
- Docker やリモートで動かしているときは `ZUNDAMON_VOICEVOX_HOST=http://<host>:50021` で向き先を変えられます。

### デバッグしたい

環境変数 `ZUNDAMON_DEBUG=1` を付けて実行すると、stderr に実行経路や失敗理由が出ます。

```bash
ZUNDAMON_DEBUG=1 node .claude/hooks/notify.mjs Stop
```

---

## セキュリティ上の注意

通常の個人利用では問題になりませんが、マルチユーザー環境や共有開発サーバーで使う場合は以下を確認してください。

### `ZUNDAMON_VOICEVOX_HOST` を localhost 以外に向ける場合

リアルタイム合成モード (`ZUNDAMON_USE_VOICEVOX=1`) では、読み上げフレーズ (`phrases.json` で設定した文字列) が指定したホストへ **プレーンな HTTP POST** で送信されます。デフォルト (`http://127.0.0.1:50021`) はループバックアドレスなのでホスト外に出ませんが、Docker やリモートホストを向けた場合はフレーズがそのホストへ送出されます。**社内情報や機密を含むフレーズを設定したまま外部ホストへ向けないでください。**

### `phrases.json` は自己管理ファイルとして扱われます

`~/.config/himari-code-notify/phrases.json` はスクリプトが信頼する設定ファイルです。OS コマンドインジェクションは各所で防御済みですが、**第三者から受け取った `phrases.json` を無検査で配置すると、読み上げ内容の乗っ取りが可能です**。自分で管理するファイル以外は置かないでください。

### 環境変数の書き換え権限

`ZUNDAMON_ASSETS_DIR` を書き換えられると再生音声を差し替えられます。`ZUNDAMON_VOICEVOX_HOST` を書き換えられるとフレーズが外部へ送出されます。共有サーバーで使う場合はシェル設定ファイル (`.bashrc` / `.zshrc` など) の**権限とオーナーが自分のみ**になっていることを確認してください。

---

## クレジット

本プロジェクトで使用する音声は **`VOICEVOX:冥鳴ひまり`** によって生成されています。

- VOICEVOX: https://voicevox.hiroshiba.jp/
- 冥鳴ひまり: https://www.meimeihimari.com/

再配布・利用にあたっては、各公式規約に従ってください。詳細は [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。

本リポジトリは [zundamon-code-notify](https://github.com/) の fork です。コードベースの設計・実装は上流のものを継承しています。

---

## ライセンス

本リポジトリ内のコード・ドキュメントは [MIT License](./LICENSE) のもとで公開しています。元 zundamon-code-notify の著作権表記は MIT 規約に従って LICENSE 内に保持しています。

ただし、`assets/` 配下に配置される **音声データ** は MIT ライセンスの対象外で、VOICEVOX 利用規約 / 冥鳴ひまり利用規約が優先されます。

---

## ⚠ 公開前に必ず最新規約を確認してください

VOICEVOX および冥鳴ひまりの利用規約は更新される可能性があります。
**あなた自身の責任で、本リポジトリを公開・再配布する前に最新の規約を確認してください。**

- VOICEVOX 利用規約: https://voicevox.hiroshiba.jp/term/
- 冥鳴ひまり利用規約: https://www.meimeihimari.com/terms-of-use

公序良俗に反する用途、政治・宗教活動、情報商材、虚偽情報の拡散、反社会的勢力との関与など、各規約で禁止されている用途では **絶対に使用しないでください**。

---

## Examples

### Claude Code 用設定

```jsonc
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "ZUNDAMON_USE_VOICEVOX=1 node \"$CLAUDE_PROJECT_DIR/.claude/hooks/notify.mjs\" Stop"
      }
    ],
    "Notification": [
      {
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/notify.mjs\" Notification"
      }
    ],
    "SubagentStop": [
      {
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/notify.mjs\" SubagentStop"
      }
    ],
    "UserApproval": [
      {
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/notify.mjs\" UserApproval"
      }
    ]
  }
}
```

### Codex CLI 用設定

```jsonc
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "node \"/absolute/path/to/.claude/hooks/notify.mjs\" Stop"
      }
    ],
    "Notification": [
      {
        "type": "command",
        "command": "node \"/absolute/path/to/.claude/hooks/notify.mjs\" Notification"
      }
    ],
    "UserApproval": [
      {
        "type": "command",
        "command": "node \"/absolute/path/to/.claude/hooks/notify.mjs\" UserApproval"
      }
    ]
  }
}
```

---

## GitHub リポジトリ公開向けメタ情報

GitHub 上で本リポジトリを公開するときに推奨する About 欄の設定です。

- **Description** (推奨):

  > Cross-platform Mei Himari (冥鳴ひまり) voice notifications for Claude Code and Codex CLI. Works on macOS and Windows/WSL2, with optional VOICEVOX realtime synthesis.

- **Topics** (推奨):

  `claude-code`, `codex-cli`, `voicevox`, `mei-himari`, `himari`, `hooks`, `notifications`, `nodejs`, `wsl2`, `macos`
