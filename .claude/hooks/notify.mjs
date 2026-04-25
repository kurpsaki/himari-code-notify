#!/usr/bin/env node
// =============================================================================
// himari-code-notify / notify.mjs   (Stage 2)
// -----------------------------------------------------------------------------
// Claude Code / OpenAI Codex CLI の hook から呼び出され、
// 冥鳴ひまりボイスを鳴らしつつデスクトップ通知を出す共通スクリプト。
//
// 対応OS:
//   - macOS           : afplay (再生) + osascript (通知)
//   - Windows         : powershell.exe (再生 & NotifyIcon バルーン)
//   - Windows (WSL2)  : powershell.exe 経由 + wslpath 変換
//   - Linux           : paplay / aplay (再生) + notify-send (通知)  [experimental]
//
// 依存: Node.js 18+ の標準モジュールのみ (外部 npm パッケージ不要)
//
// 使い方:
//   node notify.mjs <EventName>
//     <EventName> := Stop | Notification | SubagentStop | UserApproval
//
//   Claude Code / Codex CLI の hook からは stdin に JSON が流れてくる場合があるが、
//   このスクリプトでは stdin の内容は参照せず、引数の EventName だけを見る。
//
// Stage 2 で追加した主な機能:
//   - VOICEVOX リアルタイム合成 (ZUNDAMON_USE_VOICEVOX=1)
//   - ユーザー設定ファイル ~/.config/himari-code-notify/phrases.json
//   - Linux ネイティブ対応 (paplay / aplay / notify-send)
//   - 環境変数の追加: ZUNDAMON_USE_VOICEVOX / ZUNDAMON_SPEAKER_ID
//                      ZUNDAMON_VOICEVOX_HOST / ZUNDAMON_DRY_RUN
//
// hook は絶対に落ちない。どんな例外が出ても exit 0 で終わる。
// =============================================================================

import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { promisify } from 'node:util';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// -----------------------------------------------------------------------------
// 設定: イベント -> 音声ファイル / デフォルトフレーズ
// -----------------------------------------------------------------------------

// 同梱 WAV のファイル名 (assets/ 以下)
// 注: UserApproval は「論理イベント」なので専用 WAV を持たない。
//     VOICEVOX リアルタイム合成モードのときだけ音が鳴り、
//     通常モードでは通知のみ出る。
const EVENT_AUDIO = {
  Stop: 'done.wav',
  Notification: 'attention.wav',
  SubagentStop: 'subagent_done.wav',
};

// デフォルトフレーズ (有効イベントの真実の源)
//   同梱 WAV を持つイベントは WAV の内容と一致させてある。
//   phrases.json で上書き可能。
const DEFAULT_PHRASES = {
  Stop: '作業が完了したわ。',
  Notification: '確認が必要よ。',
  SubagentStop: 'サブタスクが完了したわ。',
  UserApproval: '許可が必要よ。',
};

// phrases.json のキー名マッピング
const PHRASE_CONFIG_KEYS = {
  Stop: 'stop',
  Notification: 'notification',
  SubagentStop: 'subagentStop',
  UserApproval: 'userApproval',
};

// VOICEVOX:冥鳴ひまり (ノーマル)
const DEFAULT_SPEAKER_ID = 14;

// VOICEVOX ローカルエンジンの既定ホスト
//   localhost ではなく IPv4 を明示 (::1 フォールバックでハングするのを防ぐ)
const VOICEVOX_DEFAULT_HOST = 'http://127.0.0.1:50021';

const NOTIFICATION_TITLE = 'Himari Code Notify';

// -----------------------------------------------------------------------------
// ユーティリティ
// -----------------------------------------------------------------------------

/** デバッグログ。ZUNDAMON_DEBUG=1 の時だけ stderr に出す */
function logDebug(msg) {
  if (process.env.ZUNDAMON_DEBUG === '1') {
    process.stderr.write(`[himari-notify] ${msg}\n`);
  }
}

/** 警告ログ。常に stderr に出す (設定ファイルのパースエラー等) */
function logWarn(msg) {
  process.stderr.write(`[himari-notify] WARN: ${msg}\n`);
}

/** stdin を読み捨てる (hook が stdin を送ってくる場合に備えて) */
function drainStdin() {
  try {
    if (process.stdin.isTTY) return;
    process.stdin.resume();
    process.stdin.on('data', () => {});
    process.stdin.on('error', () => {});
  } catch {
    // ignore
  }
}

/**
 * 実行OSを判定する。
 *   'macos' | 'wsl' | 'windows' | 'linux' | 'unknown'
 */
function detectPlatform() {
  const platform = os.platform();
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') {
    // WSL 判定: os.release() に 'microsoft' / 'WSL' が含まれる
    try {
      const release = os.release().toLowerCase();
      if (release.includes('microsoft') || release.includes('wsl')) {
        return 'wsl';
      }
    } catch {
      // ignore
    }
    return 'linux';
  }
  return 'unknown';
}

/**
 * 音声ファイルのあるディレクトリを解決する。
 *
 * 探索順:
 *   1. 環境変数 ZUNDAMON_ASSETS_DIR
 *   2. <notify.mjs の 2 階層上>/assets   (通常の .claude/hooks/ 配置)
 *   3. <notify.mjs の 1 階層上>/assets
 *   4. <notify.mjs の同階層>/assets
 */
function resolveAssetsDir() {
  const envDir = process.env.ZUNDAMON_ASSETS_DIR;
  if (envDir && existsSync(envDir)) {
    return envDir;
  }
  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(hereDir, '..', '..', 'assets'),
    path.resolve(hereDir, '..', 'assets'),
    path.resolve(hereDir, 'assets'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

/** ファイルが存在し、中身が 0 バイトでないかどうか */
function isPlayableFile(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    const s = statSync(filePath);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

/** WSL の Linux パスを Windows パスへ変換する。失敗したら null を返す */
async function wslToWindowsPath(linuxPath) {
  try {
    const { stdout } = await execFileAsync('wslpath', ['-w', linuxPath]);
    return stdout.trim();
  } catch (e) {
    logDebug(`wslpath failed: ${e.message}`);
    return null;
  }
}

/** AppleScript 用の文字列エスケープ */
function escapeAppleScript(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** PowerShell シングルクォート文字列用のエスケープ */
function escapePSSingleQuoted(s) {
  return String(s).replace(/'/g, "''");
}

// -----------------------------------------------------------------------------
// ユーザー設定ファイル (~/.config/himari-code-notify/phrases.json)
// -----------------------------------------------------------------------------

/** 設定ファイルの絶対パス (Windows は %USERPROFILE%/.config/...) */
function getUserConfigPath() {
  const home = os.homedir();
  return path.join(home, '.config', 'himari-code-notify', 'phrases.json');
}

/**
 * ユーザー設定を読み込む。
 *   - 存在しない   → null (デバッグログのみ)
 *   - パースエラー → null (警告を stderr に出す)
 */
function loadUserConfig() {
  const p = getUserConfigPath();
  if (!existsSync(p)) {
    logDebug(`user config not found (using defaults): ${p}`);
    return null;
  }
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    logDebug(`user config loaded: ${p}`);
    return parsed;
  } catch (e) {
    logWarn(`failed to parse user config (${p}): ${e.message}. using defaults.`);
    return null;
  }
}

/**
 * イベントに対応するフレーズを解決する。
 *   優先順位: phrases.json > DEFAULT_PHRASES
 */
function resolvePhrase(eventName, userConfig) {
  const key = PHRASE_CONFIG_KEYS[eventName];
  if (
    userConfig &&
    key &&
    typeof userConfig[key] === 'string' &&
    userConfig[key].length > 0
  ) {
    return userConfig[key];
  }
  return DEFAULT_PHRASES[eventName] || DEFAULT_PHRASES.Stop;
}

/**
 * VOICEVOX 話者 ID を解決する。
 *   優先順位: phrases.json.speakerId > ZUNDAMON_SPEAKER_ID > デフォルト
 */
function resolveSpeakerId(userConfig) {
  if (userConfig && Number.isInteger(userConfig.speakerId)) {
    return userConfig.speakerId;
  }
  const envRaw = process.env.ZUNDAMON_SPEAKER_ID;
  if (envRaw !== undefined && envRaw !== '') {
    const n = Number.parseInt(envRaw, 10);
    if (Number.isInteger(n)) return n;
    logWarn(`ZUNDAMON_SPEAKER_ID is not a valid integer: ${envRaw}`);
  }
  return DEFAULT_SPEAKER_ID;
}

// -----------------------------------------------------------------------------
// HTTP ヘルパ (Node 標準 http モジュールのみ)
// -----------------------------------------------------------------------------

/**
 * シンプルな POST ラッパ。VOICEVOX ローカルエンジン専用なので http:// のみ対応。
 *   - urlString : 完全な URL (例: "http://127.0.0.1:50021/audio_query?...")
 *   - bodyText  : string | null  (null のときは空ボディで POST)
 *   - headers   : Record<string,string>
 *
 * 成功時: { status, body: Buffer }
 * 失敗時: reject(Error)
 */
function httpPost(urlString, bodyText, headers = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch {
      reject(new Error(`invalid URL: ${urlString}`));
      return;
    }
    if (u.protocol !== 'http:') {
      reject(new Error(`only http:// is supported, got: ${u.protocol}`));
      return;
    }
    const bodyBuf = bodyText != null ? Buffer.from(bodyText, 'utf8') : null;
    const reqHeaders = { ...headers };
    reqHeaders['Content-Length'] = bodyBuf ? bodyBuf.length : 0;

    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: 'POST',
        headers: reqHeaders,
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, body: buf });
          } else {
            const preview = buf.toString('utf8').slice(0, 200);
            reject(new Error(`HTTP ${res.statusCode}: ${preview}`));
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// -----------------------------------------------------------------------------
// VOICEVOX リアルタイム合成
// -----------------------------------------------------------------------------

/**
 * ローカル VOICEVOX エンジンに対して audio_query → synthesis を叩き、
 * 一時 WAV ファイルのパスを返す。
 *
 * 呼び出し側は再生が終わったら戻り値のパスを unlink すること。
 *
 *   VOICEVOX API:
 *     POST /audio_query?text=...&speaker=ID        → JSON (クエリ)
 *     POST /synthesis?speaker=ID  body=上記 JSON   → audio/wav
 */
async function synthesizeWithVoicevox(text, speakerId) {
  const host = (
    process.env.ZUNDAMON_VOICEVOX_HOST || VOICEVOX_DEFAULT_HOST
  ).replace(/\/+$/, '');
  logDebug(`voicevox host=${host} speaker=${speakerId} text="${text}"`);

  // ---- Step 1: audio_query (POST, ボディなし、クエリ文字列で渡す) ----
  const queryUrl =
    `${host}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`;
  logDebug(`voicevox audio_query: ${queryUrl}`);
  const queryRes = await httpPost(queryUrl, null, {
    accept: 'application/json',
  });
  let queryBody = queryRes.body.toString('utf8');

  // ---- 拡張ポイント (将来) --------------------------------------------
  // ここで JSON をパースして speedScale / pitchScale / volumeScale 等を
  // 書き換えるとトーン調整ができる。例:
  //   const q = JSON.parse(queryBody);
  //   q.speedScale = 1.1;
  //   q.volumeScale = 0.9;
  //   queryBody = JSON.stringify(q);
  // --------------------------------------------------------------------

  // ---- Step 2: synthesis (POST, JSON ボディ → audio/wav) ----
  const synthUrl = `${host}/synthesis?speaker=${speakerId}`;
  logDebug(`voicevox synthesis: ${synthUrl}`);
  const synthRes = await httpPost(synthUrl, queryBody, {
    accept: 'audio/wav',
    'Content-Type': 'application/json',
  });

  if (!synthRes.body || synthRes.body.length === 0) {
    throw new Error('voicevox synthesis returned empty body');
  }

  // ---- Step 3: 一時ファイルに保存 ----
  // mkdtempSync で mode 0700 の専用ディレクトリを作ってからその中に書く。
  // /tmp 共有環境での symlink race (先置きによる任意書き込み) を防ぐ。
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'himari-'));
  const tmpFile = path.join(tmpDir, 'voice.wav');
  writeFileSync(tmpFile, synthRes.body);
  logDebug(`voicevox synth OK: ${tmpFile} (${synthRes.body.length} bytes)`);
  return tmpFile;
}

/** 一時ファイルとその mkdtempSync 親ディレクトリを best-effort で削除 */
function cleanupTempFile(filePath) {
  if (!filePath) return;
  try {
    unlinkSync(filePath);
    logDebug(`temp file removed: ${filePath}`);
  } catch (e) {
    logDebug(`failed to remove temp file: ${e.message}`);
  }
  // mkdtempSync で作った親ディレクトリ (himari-XXXXXX) も削除する
  try {
    const parent = path.dirname(filePath);
    if (path.basename(parent).startsWith('himari-')) {
      rmSync(parent, { recursive: true, force: true });
      logDebug(`temp dir removed: ${parent}`);
    }
  } catch (e) {
    logDebug(`failed to remove temp dir: ${e.message}`);
  }
}

// -----------------------------------------------------------------------------
// macOS 向け実装
// -----------------------------------------------------------------------------

async function playMac(audioPath) {
  try {
    await execFileAsync('afplay', [audioPath], { timeout: 15000 });
  } catch (e) {
    logDebug(`afplay failed: ${e.message}`);
  }
}

async function notifyMac(message) {
  try {
    const script =
      `display notification "${escapeAppleScript(message)}" ` +
      `with title "${escapeAppleScript(NOTIFICATION_TITLE)}"`;
    await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  } catch (e) {
    logDebug(`osascript failed: ${e.message}`);
  }
}

// -----------------------------------------------------------------------------
// Windows (WSL2) 向け実装
// -----------------------------------------------------------------------------

/**
 * WSL から powershell.exe を叩いて WAV を再生する。
 * System.Media.SoundPlayer.PlaySync() で再生完了までブロック。
 */
async function playWindowsFromWSL(audioPath) {
  let winPath = audioPath;
  if (audioPath.startsWith('/')) {
    const converted = await wslToWindowsPath(audioPath);
    if (!converted) {
      logDebug('wslpath conversion failed, skipping audio');
      return;
    }
    winPath = converted;
  }
  const safePath = escapePSSingleQuoted(winPath);
  const ps =
    `$ErrorActionPreference='SilentlyContinue'; ` +
    `$p = New-Object System.Media.SoundPlayer '${safePath}'; ` +
    `$p.PlaySync();`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], {
      timeout: 15000,
    });
  } catch (e) {
    logDebug(`powershell play failed: ${e.message}`);
  }
}

/**
 * WSL から powershell.exe でバルーン通知を出す。
 *   - 外部モジュール (BurntToast 等) は使わない
 *   - System.Windows.Forms.NotifyIcon のバルーンチップを利用
 */
async function notifyWindowsFromWSL(message) {
  const safeTitle = escapePSSingleQuoted(NOTIFICATION_TITLE);
  const safeMsg = escapePSSingleQuoted(message);
  const ps = [
    `$ErrorActionPreference='SilentlyContinue';`,
    `Add-Type -AssemblyName System.Windows.Forms;`,
    `Add-Type -AssemblyName System.Drawing;`,
    `$balloon = New-Object System.Windows.Forms.NotifyIcon;`,
    `$balloon.Icon = [System.Drawing.SystemIcons]::Information;`,
    `$balloon.BalloonTipTitle = '${safeTitle}';`,
    `$balloon.BalloonTipText = '${safeMsg}';`,
    `$balloon.Visible = $true;`,
    `$balloon.ShowBalloonTip(4000);`,
    `Start-Sleep -Milliseconds 4500;`,
    `$balloon.Dispose();`,
  ].join(' ');
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], {
      timeout: 10000,
    });
  } catch (e) {
    logDebug(`powershell notify failed: ${e.message}`);
  }
}

// -----------------------------------------------------------------------------
// Windows ネイティブ (cmd / PowerShell から直接 node を呼んだ場合)
// -----------------------------------------------------------------------------

async function playWindowsNative(audioPath) {
  const safePath = escapePSSingleQuoted(audioPath);
  const ps =
    `$ErrorActionPreference='SilentlyContinue'; ` +
    `$p = New-Object System.Media.SoundPlayer '${safePath}'; $p.PlaySync();`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], {
      timeout: 15000,
    });
  } catch (e) {
    logDebug(`powershell play (native) failed: ${e.message}`);
  }
}

async function notifyWindowsNative(message) {
  return notifyWindowsFromWSL(message);
}

// -----------------------------------------------------------------------------
// Linux ネイティブ (experimental)
// -----------------------------------------------------------------------------

/**
 * 再生: paplay (PulseAudio/PipeWire) → aplay (ALSA) の順に試す。
 *      どれも存在しない場合はデバッグログを出して諦める (exit 0 は維持)。
 */
async function playLinux(audioPath) {
  const candidates = ['paplay', 'aplay'];
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, [audioPath], { timeout: 15000 });
      logDebug(`${cmd} playback OK`);
      return;
    } catch (e) {
      // ENOENT = コマンドが存在しない。次の候補を試す。
      logDebug(`${cmd} failed: ${e.message}`);
    }
  }
  logDebug(
    `No Linux audio player available (tried: ${candidates.join(', ')}). ` +
      `Install 'pulseaudio-utils' or 'alsa-utils'.`
  );
}

/** 通知: notify-send を使う。無ければ諦める。 */
async function notifyLinux(message) {
  try {
    await execFileAsync('notify-send', [NOTIFICATION_TITLE, message], {
      timeout: 5000,
    });
    logDebug('notify-send OK');
  } catch (e) {
    logDebug(
      `notify-send failed or not installed: ${e.message}. ` +
        `Install 'libnotify-bin' to enable Linux desktop notifications.`
    );
  }
}

// -----------------------------------------------------------------------------
// メイン
// -----------------------------------------------------------------------------

async function main() {
  drainStdin();

  // ---- 1. イベント名の正規化 ----
  // 有効イベントの判定は DEFAULT_PHRASES を真実の源とする。
  // EVENT_AUDIO に無いイベント (例: UserApproval) は論理イベントとして扱い、
  // バンドル WAV を持たずフレーズだけ解決する。
  const rawEvent = process.argv[2] || 'Stop';
  const eventName = DEFAULT_PHRASES[rawEvent] ? rawEvent : 'Stop';
  if (eventName !== rawEvent) {
    logDebug(`unknown event: ${rawEvent}. falling back to Stop.`);
  }

  // ---- 2. ユーザー設定の読み込みとフレーズ/話者の解決 ----
  const userConfig = loadUserConfig();
  const phrase = resolvePhrase(eventName, userConfig);
  const speakerId = resolveSpeakerId(userConfig);
  logDebug(`event=${eventName} phrase="${phrase}" speaker=${speakerId}`);

  // ---- 3. 音源の決定 ----
  //   優先順位:
  //     A. ZUNDAMON_USE_VOICEVOX=1 のとき VOICEVOX リアルタイム生成
  //     B. A が失敗 or 未指定のとき assets/*.wav
  let audioPath = null;
  let tempFile = null;

  const useVoicevox = process.env.ZUNDAMON_USE_VOICEVOX === '1';
  if (useVoicevox) {
    try {
      tempFile = await synthesizeWithVoicevox(phrase, speakerId);
      audioPath = tempFile;
    } catch (e) {
      logDebug(
        `VOICEVOX synth failed, falling back to bundled assets: ${e.message}`
      );
    }
  }

  if (!audioPath) {
    const fallbackFile = EVENT_AUDIO[eventName];
    if (fallbackFile) {
      const assetsDir = resolveAssetsDir();
      const fallbackPath = path.join(assetsDir, fallbackFile);
      if (isPlayableFile(fallbackPath)) {
        audioPath = fallbackPath;
      } else {
        logDebug(`fallback audio missing or empty: ${fallbackPath}`);
      }
    } else {
      // 論理イベント (UserApproval 等): 専用 WAV は無い。
      // 通知は通常どおり出るが、音は VOICEVOX リアルタイム合成時のみ鳴る。
      logDebug(`no bundled audio for event=${eventName} (logical event only)`);
    }
  }

  // ---- 4. プラットフォーム別に再生 + 通知をディスパッチ ----
  const platform = detectPlatform();
  logDebug(`platform=${platform} audio=${audioPath || '<none>'}`);

  // テスト用: ZUNDAMON_DRY_RUN=1 のときは実際の再生/通知をスキップする
  //   (VOICEVOX 合成やフォールバック判定のロジックは一通り走る)
  const dryRun = process.env.ZUNDAMON_DRY_RUN === '1';

  if (dryRun) {
    logDebug('dry-run: skipping playback and notification');
  } else {
    const tasks = [];
    switch (platform) {
      case 'macos':
        if (audioPath) tasks.push(playMac(audioPath));
        tasks.push(notifyMac(phrase));
        break;
      case 'wsl':
        if (audioPath) tasks.push(playWindowsFromWSL(audioPath));
        tasks.push(notifyWindowsFromWSL(phrase));
        break;
      case 'windows':
        if (audioPath) tasks.push(playWindowsNative(audioPath));
        tasks.push(notifyWindowsNative(phrase));
        break;
      case 'linux':
        if (audioPath) tasks.push(playLinux(audioPath));
        tasks.push(notifyLinux(phrase));
        break;
      default:
        logDebug(`unsupported platform: ${platform}`);
    }
    // 再生と通知を並列実行。どれかが失敗しても全体は落とさない。
    await Promise.allSettled(tasks);
  }

  // ---- 5. 一時ファイルの後始末 ----
  if (tempFile) {
    cleanupTempFile(tempFile);
  }
}

// hook は失敗しても Claude Code / Codex CLI 本体を止めてはいけない。
// どんな例外が出ても exit 0 で終わらせる。
main()
  .catch((e) => {
    logDebug(`main() unexpected error: ${e?.stack || e}`);
  })
  .finally(() => {
    process.exit(0);
  });
