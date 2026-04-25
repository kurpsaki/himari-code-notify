#!/usr/bin/env bash
# =============================================================================
# scripts/generate-voices.sh
# -----------------------------------------------------------------------------
# ローカルで起動している VOICEVOX エンジンに HTTP リクエストを投げ、
# assets/ 以下に通知用 WAV ファイルを生成するスクリプト。
#
# 前提:
#   - VOICEVOX エディタ or 単体エンジンがローカルで起動している
#     (デフォルト: http://127.0.0.1:50021)
#   - curl がインストールされている
#   - jq があると便利だが必須ではない (このスクリプトでは使わない)
#
# 使い方:
#   1. VOICEVOX を起動する
#   2. このスクリプトを実行する
#        bash scripts/generate-voices.sh
#   3. assets/*.wav が上書き生成される
#
# キャラやフレーズを変えたい場合は下記の変数を編集してください。
# =============================================================================

set -euo pipefail

# ---- 設定 -------------------------------------------------------------------

# VOICEVOX エンジンのエンドポイント
VOICEVOX_HOST="${VOICEVOX_HOST:-http://127.0.0.1:50021}"

# スピーカー ID
#   14 : 冥鳴ひまり (ノーマル)   <- 既定値 (本リポジトリは himari ノーマルのみ対応)
#   詳細は http://127.0.0.1:50021/speakers を参照
SPEAKER_ID="${SPEAKER_ID:-14}"

# 出力先ディレクトリ (このスクリプトから見た相対パス)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="${SCRIPT_DIR}/../assets"

# ファイル名 -> 読み上げるフレーズ
# (notify.mjs の DEFAULT_PHRASES と一致させている)
PHRASE_DONE="${PHRASE_DONE:-作業が完了したわ。}"
PHRASE_ATTENTION="${PHRASE_ATTENTION:-確認が必要よ。}"
PHRASE_SUBAGENT="${PHRASE_SUBAGENT:-サブタスクが完了したわ。}"

# ---- 便利関数 ---------------------------------------------------------------

log() {
  printf '[generate-voices] %s\n' "$*"
}

die() {
  printf '[generate-voices] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' が見つかりません。インストールしてください。"
}

# URL エンコード (外部依存なし)
urlencode() {
  local LC_ALL=C
  local str="$1"
  local i c
  for (( i=0; i<${#str}; i++ )); do
    c="${str:i:1}"
    case "$c" in
      [a-zA-Z0-9._~-]) printf '%s' "$c" ;;
      *)               printf '%%%02X' "'$c" ;;
    esac
  done
}

# VOICEVOX 疎通確認
check_voicevox() {
  log "VOICEVOX エンジンに接続確認中: ${VOICEVOX_HOST}"
  if ! curl -fsS --max-time 3 "${VOICEVOX_HOST}/version" >/dev/null; then
    die "VOICEVOX エンジンに接続できません。起動していますか? (${VOICEVOX_HOST})"
  fi
  log "接続 OK"
}

# 1 フレーズを WAV に変換して保存する
#   $1: 出力ファイル名 (例: done.wav)
#   $2: 読み上げテキスト
synthesize() {
  local outfile="$1"
  local text="$2"
  local encoded
  encoded="$(urlencode "$text")"

  local query_json
  query_json="$(mktemp)"
  trap 'rm -f "$query_json"' RETURN

  log "生成中: ${outfile}  <- \"${text}\""

  # 1) audio_query: 音声合成用のクエリ (JSON) を取得
  curl -fsS -X POST \
    "${VOICEVOX_HOST}/audio_query?text=${encoded}&speaker=${SPEAKER_ID}" \
    -H 'accept: application/json' \
    -o "$query_json" \
    || die "audio_query に失敗しました (${outfile})"

  # 2) synthesis: クエリから WAV を合成
  curl -fsS -X POST \
    "${VOICEVOX_HOST}/synthesis?speaker=${SPEAKER_ID}" \
    -H 'accept: audio/wav' \
    -H 'Content-Type: application/json' \
    --data-binary "@${query_json}" \
    -o "${ASSETS_DIR}/${outfile}" \
    || die "synthesis に失敗しました (${outfile})"
}

# ---- メイン -----------------------------------------------------------------

main() {
  require_cmd curl
  mkdir -p "$ASSETS_DIR"

  check_voicevox

  synthesize "done.wav"          "$PHRASE_DONE"
  synthesize "attention.wav"     "$PHRASE_ATTENTION"
  synthesize "subagent_done.wav" "$PHRASE_SUBAGENT"

  log "完了! -> ${ASSETS_DIR}"
  log "  done.wav          : ${PHRASE_DONE}"
  log "  attention.wav     : ${PHRASE_ATTENTION}"
  log "  subagent_done.wav : ${PHRASE_SUBAGENT}"
  log ""
  log "生成した音声の利用は VOICEVOX 利用規約と冥鳴ひまり利用規約に従ってください。"
  log "  - https://voicevox.hiroshiba.jp/term/"
  log "  - https://www.meimeihimari.com/terms-of-use"
}

main "$@"
