#!/usr/bin/env bash
# =============================================================================
# scripts/setup.sh
# -----------------------------------------------------------------------------
# himari-code-notify の初期セットアップを支援するスクリプト。
#
# やること:
#   1. Node.js がインストールされているかチェック
#   2. notify.mjs / *.sh に実行権限を付与
#   3. 音声ファイルが揃っているかチェック (空ならプレースホルダー警告)
#   4. OS を判定して必要なコマンドが使えるかチェック
#   5. 最後に Claude Code / Codex CLI への設定方法を案内
#
# 使い方:
#   bash scripts/setup.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${GREEN}[OK]${RESET}   %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${RESET} %s\n" "$*"; }
err()   { printf "${RED}[FAIL]${RESET} %s\n" "$*"; }
head()  { printf "\n${BOLD}==> %s${RESET}\n" "$*"; }

# -----------------------------------------------------------------------------
# 1. Node.js チェック
# -----------------------------------------------------------------------------
head "Node.js の確認"
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v)"
  info "Node.js が見つかりました: ${NODE_VER}"
else
  err "Node.js が見つかりません。https://nodejs.org/ から LTS をインストールしてください。"
  exit 1
fi

# -----------------------------------------------------------------------------
# 2. スクリプトに実行権限を付与
# -----------------------------------------------------------------------------
head "実行権限を付与"
chmod +x "${REPO_ROOT}/.claude/hooks/notify.mjs" 2>/dev/null || true
chmod +x "${REPO_ROOT}/scripts/generate-voices.sh" 2>/dev/null || true
chmod +x "${REPO_ROOT}/scripts/setup.sh" 2>/dev/null || true
info "chmod +x を付与しました"

# -----------------------------------------------------------------------------
# 3. 音声ファイルの確認
# -----------------------------------------------------------------------------
head "音声ファイルの確認"
ASSETS_DIR="${REPO_ROOT}/assets"
REQUIRED_WAVS=(done.wav attention.wav subagent_done.wav)
MISSING=0
EMPTY=0
for f in "${REQUIRED_WAVS[@]}"; do
  path="${ASSETS_DIR}/${f}"
  if [[ ! -e "$path" ]]; then
    err "${f} が見つかりません"
    MISSING=$((MISSING+1))
  elif [[ ! -s "$path" ]]; then
    warn "${f} は空ファイル (プレースホルダー) です"
    EMPTY=$((EMPTY+1))
  else
    info "${f} OK"
  fi
done
if (( EMPTY > 0 )); then
  warn "音声が未配置です。以下のいずれかの方法で用意してください:"
  warn "  A) VOICEVOX を起動して 'bash scripts/generate-voices.sh' を実行"
  warn "  B) 手持ちの WAV ファイルを assets/ に上書き配置"
fi

# -----------------------------------------------------------------------------
# 4. OS 判定とコマンド存在確認
# -----------------------------------------------------------------------------
head "OS / コマンド確認"
UNAME_S="$(uname -s 2>/dev/null || echo unknown)"
case "$UNAME_S" in
  Darwin*)
    info "OS: macOS"
    if command -v afplay   >/dev/null 2>&1; then info "afplay OK";   else err "afplay が見つかりません";   fi
    if command -v osascript>/dev/null 2>&1; then info "osascript OK";else err "osascript が見つかりません";fi
    ;;
  Linux*)
    if grep -qi -e microsoft -e wsl /proc/version 2>/dev/null; then
      info "OS: Linux (WSL2)"
      if command -v powershell.exe >/dev/null 2>&1; then
        info "powershell.exe OK"
      else
        err "powershell.exe が呼べません。Windows 側の PATH を確認してください。"
      fi
      if command -v wslpath >/dev/null 2>&1; then
        info "wslpath OK"
      else
        warn "wslpath が見つかりません。WSL2 を利用してください。"
      fi
    else
      info "OS: Linux (native)"
      warn "Linux ネイティブ対応は将来実装予定です。notify-send があれば通知だけ鳴ります。"
    fi
    ;;
  *)
    warn "未知の OS: ${UNAME_S}"
    ;;
esac

# -----------------------------------------------------------------------------
# 5. 動作テスト (任意)
# -----------------------------------------------------------------------------
head "動作テスト"
info "notify.mjs を Stop イベントで実行してみます..."
ZUNDAMON_DEBUG=1 node "${REPO_ROOT}/.claude/hooks/notify.mjs" Stop || true

# -----------------------------------------------------------------------------
# 6. zundamon-code-notify 競合チェック
# -----------------------------------------------------------------------------
head "zundamon-code-notify 競合チェック"
GLOBAL_SETTINGS="${HOME}/.claude/settings.json"
if [[ -f "$GLOBAL_SETTINGS" ]] && grep -q "zundamon-code-notify" "$GLOBAL_SETTINGS" 2>/dev/null; then
  warn "競合検出: ${GLOBAL_SETTINGS} に zundamon-code-notify の hook エントリが残っています。"
  warn "himari-code-notify と同時に有効だと二重通知になります。"
  warn "設定ファイルから zundamon-code-notify のエントリを削除してください。"
else
  info "競合なし (zundamon-code-notify エントリは見つかりませんでした)"
fi

# -----------------------------------------------------------------------------
# 7. 設定方法の案内
# -----------------------------------------------------------------------------
head "Claude Code / Codex CLI への設定方法"
cat <<EOS

[Claude Code]
  このリポジトリ直下で Claude Code を起動すれば .claude/settings.json が
  自動で読み込まれ、hook が有効になります。別プロジェクトでも使いたい場合は
  当該プロジェクトの .claude/settings.json に下記を追記してください:

      "hooks": {
        "Stop": [{
          "matcher": "",
          "hooks": [{
            "type": "command",
            "command": "node \"${REPO_ROOT}/.claude/hooks/notify.mjs\" Stop"
          }]
        }]
      }

  (Notification / SubagentStop も同様に登録できます)

[Codex CLI]
  examples/codex-hooks-config.yaml を参考に ~/.codex/config.toml などへ
  下記のような設定を追加してください:

      notify = ["node", "${REPO_ROOT}/.claude/hooks/notify.mjs", "Stop"]

セットアップ完了! 静かな冥鳴ひまりライフをお楽しみください。
EOS
