#!/usr/bin/env node
// =============================================================================
// scripts/test.mjs
// -----------------------------------------------------------------------------
// notify.mjs の簡易テストランナー。
// Node.js 標準モジュールのみで実装 (外部テストフレームワーク不要)。
//
// 検証するシナリオ (Stage 2 要件):
//   1. VOICEVOX なし + 環境変数なし                → 同梱 WAV で鳴る (exit 0)
//   2. VOICEVOX なし + ZUNDAMON_USE_VOICEVOX=1     → フォールバック (exit 0)
//   3. VOICEVOX あり + ZUNDAMON_USE_VOICEVOX=1     → リアルタイム生成 (exit 0)
//   4. phrases.json あり/なしでフレーズが切り替わる
//   5. 未知のイベント / 壊れた phrases.json でも落ちない
//
// いずれのケースでも notify.mjs は exit 0 で終わる必要がある。
//
// 注: テスト中は ZUNDAMON_DRY_RUN=1 を指定して実際の再生/通知をスキップする。
//     (VOICEVOX 合成や設定読み込みのロジックは一通り走る)
//
// 使い方:
//   node scripts/test.mjs
// =============================================================================

import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const notifyScript = path.join(repoRoot, '.claude', 'hooks', 'notify.mjs');

// -----------------------------------------------------------------------------
// カラー出力 (TTY のときだけ)
// -----------------------------------------------------------------------------
const useColor = process.stdout.isTTY;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c('32');
const red = c('31');
const yellow = c('33');
const dim = c('2');
const bold = c('1');

// -----------------------------------------------------------------------------
// テストフレームワーク (超最小)
// -----------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ${green('✓')} ${name}\n`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    process.stdout.write(`  ${red('✗')} ${name}\n`);
    process.stdout.write(`    ${dim(e.message)}\n`);
  }
}

function skip(name, reason) {
  process.stdout.write(`  ${yellow('○')} ${name} ${dim(`(${reason})`)}\n`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(haystack, needle, label) {
  if (!String(haystack).includes(needle)) {
    throw new Error(
      `${label}: expected to include ${JSON.stringify(needle)}\n    got: ${JSON.stringify(String(haystack).slice(0, 400))}`
    );
  }
}

// -----------------------------------------------------------------------------
// notify.mjs を子プロセスで実行するヘルパ
// -----------------------------------------------------------------------------

/**
 * notify.mjs を spawn して結果を返す。
 * テストは ZUNDAMON_DRY_RUN=1 を既定で付けるので、実際には音は鳴らない。
 * stdin には疑似 hook payload を流し込む。
 */
function runNotify(event, envOverrides = {}, opts = {}) {
  const baseEnv = {
    ...process.env,
    ZUNDAMON_DRY_RUN: '1',
    ZUNDAMON_DEBUG: '1',
  };
  // HOME/USERPROFILE を上書きする場合は process.env から "継承しない" 方が安全
  const env = { ...baseEnv, ...envOverrides };
  const result = spawnSync('node', [notifyScript, event], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    input: JSON.stringify({ hook_event_name: event }),
    timeout: opts.timeout ?? 30000,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

/** VOICEVOX が起動しているかチェック (同期, タイムアウト 1.5 秒) */
function isVoicevoxRunning() {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: 50021,
        path: '/version',
        method: 'GET',
        timeout: 1500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** 一時的な HOME ディレクトリを作って phrases.json を配置する */
function withTempHome(phrasesJson) {
  const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'himari-test-'));
  if (phrasesJson !== undefined) {
    const configDir = path.join(tmpHome, '.config', 'himari-code-notify');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      path.join(configDir, 'phrases.json'),
      typeof phrasesJson === 'string' ? phrasesJson : JSON.stringify(phrasesJson)
    );
  }
  return tmpHome;
}

function cleanupTempHome(tmpHome) {
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// -----------------------------------------------------------------------------
// メイン
// -----------------------------------------------------------------------------

async function main() {
  process.stdout.write(`\n${bold('himari-code-notify')} tests\n\n`);

  if (!existsSync(notifyScript)) {
    process.stdout.write(red(`notify.mjs not found: ${notifyScript}\n`));
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 基本: デフォルト挙動
  // ---------------------------------------------------------------------------
  process.stdout.write(`${bold('[1] Default behavior (no env, no config)')}\n`);

  await test('Stop event exits 0', () => {
    const r = runNotify('Stop');
    assertEqual(r.status, 0, 'exit code');
    assertIncludes(r.stderr, 'event=Stop', 'debug output');
  });

  await test('Notification event exits 0', () => {
    const r = runNotify('Notification');
    assertEqual(r.status, 0, 'exit code');
    assertIncludes(r.stderr, 'event=Notification', 'debug output');
  });

  await test('SubagentStop event exits 0', () => {
    const r = runNotify('SubagentStop');
    assertEqual(r.status, 0, 'exit code');
    assertIncludes(r.stderr, 'event=SubagentStop', 'debug output');
  });

  await test('Unknown event falls back to Stop', () => {
    const r = runNotify('BogusEvent');
    assertEqual(r.status, 0, 'exit code');
    assertIncludes(r.stderr, 'unknown event: BogusEvent', 'fallback log');
    assertIncludes(r.stderr, 'event=Stop', 'normalized event');
  });

  await test('Default uses bundled WAV when available', () => {
    const r = runNotify('Stop');
    assertEqual(r.status, 0, 'exit code');
    // audio path should point to assets/done.wav (not a temp file)
    assertIncludes(r.stderr, 'done.wav', 'fallback audio path');
  });

  // ---------------------------------------------------------------------------
  // VOICEVOX モード
  // ---------------------------------------------------------------------------
  process.stdout.write(`\n${bold('[2] VOICEVOX realtime mode')}\n`);

  await test('ZUNDAMON_USE_VOICEVOX=1 with engine DOWN falls back to assets', () => {
    const r = runNotify('Stop', {
      ZUNDAMON_USE_VOICEVOX: '1',
      // 誰も聞いていないポートを指定してわざと接続失敗させる
      ZUNDAMON_VOICEVOX_HOST: 'http://127.0.0.1:1',
    });
    assertEqual(r.status, 0, 'exit code');
    assertIncludes(r.stderr, 'VOICEVOX synth failed', 'failure log');
    assertIncludes(r.stderr, 'done.wav', 'fell back to bundled asset');
  });

  const voicevoxUp = await isVoicevoxRunning();
  if (voicevoxUp) {
    await test('ZUNDAMON_USE_VOICEVOX=1 with engine UP generates temp WAV', () => {
      const r = runNotify('Stop', {
        ZUNDAMON_USE_VOICEVOX: '1',
      });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, 'voicevox synth OK', 'synth marker');
      assertIncludes(r.stderr, 'temp file removed', 'temp file cleanup');
    });

    await test('ZUNDAMON_USE_VOICEVOX=1 uses resolved phrase as text', () => {
      const r = runNotify('Notification', {
        ZUNDAMON_USE_VOICEVOX: '1',
      });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, '確認が必要よ', 'Notification default phrase');
    });
  } else {
    skip(
      'ZUNDAMON_USE_VOICEVOX=1 with engine UP generates temp WAV',
      'VOICEVOX not running on 127.0.0.1:50021'
    );
    skip(
      'ZUNDAMON_USE_VOICEVOX=1 uses resolved phrase as text',
      'VOICEVOX not running'
    );
  }

  // ---------------------------------------------------------------------------
  // phrases.json 設定ファイル
  // ---------------------------------------------------------------------------
  process.stdout.write(`\n${bold('[3] phrases.json config file')}\n`);

  await test('Missing phrases.json → uses defaults', () => {
    const tmpHome = withTempHome(undefined);
    try {
      const r = runNotify('Stop', { HOME: tmpHome, USERPROFILE: tmpHome });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, '作業が完了したわ。', 'default phrase');
      assertIncludes(r.stderr, 'speaker=14', 'default speaker');
    } finally {
      cleanupTempHome(tmpHome);
    }
  });

  await test('Valid phrases.json overrides phrase and speaker', () => {
    const tmpHome = withTempHome({
      speakerId: 1,
      stop: 'テストフレーズだよ',
      notification: '呼んでほしいわ',
      subagentStop: '下請け完了よ',
    });
    try {
      const r = runNotify('Stop', { HOME: tmpHome, USERPROFILE: tmpHome });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, 'テストフレーズだよ', 'overridden phrase');
      assertIncludes(r.stderr, 'speaker=1', 'overridden speaker');
      assertIncludes(r.stderr, 'user config loaded', 'config load log');
    } finally {
      cleanupTempHome(tmpHome);
    }
  });

  await test('phrases.json overrides per-event phrases', () => {
    const tmpHome = withTempHome({
      notification: 'えらいこっちゃやわ',
    });
    try {
      const r = runNotify('Notification', {
        HOME: tmpHome,
        USERPROFILE: tmpHome,
      });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, 'えらいこっちゃやわ', 'Notification phrase');
    } finally {
      cleanupTempHome(tmpHome);
    }
  });

  await test('Broken phrases.json → warning + fallback to defaults', () => {
    const tmpHome = withTempHome('this is {{ broken json');
    try {
      const r = runNotify('Stop', { HOME: tmpHome, USERPROFILE: tmpHome });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, 'WARN', 'warning emitted');
      assertIncludes(r.stderr, 'failed to parse user config', 'parse error log');
      assertIncludes(r.stderr, '作業が完了したわ。', 'fallback phrase');
    } finally {
      cleanupTempHome(tmpHome);
    }
  });

  await test('ZUNDAMON_SPEAKER_ID overrides default speaker when no config', () => {
    const tmpHome = withTempHome(undefined);
    try {
      const r = runNotify('Stop', {
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        ZUNDAMON_SPEAKER_ID: '7',
      });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, 'speaker=7', 'env-overridden speaker');
    } finally {
      cleanupTempHome(tmpHome);
    }
  });

  await test('phrases.json.speakerId wins over ZUNDAMON_SPEAKER_ID', () => {
    const tmpHome = withTempHome({ speakerId: 1 });
    try {
      const r = runNotify('Stop', {
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        ZUNDAMON_SPEAKER_ID: '7',
      });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, 'speaker=1', 'config-overridden speaker');
    } finally {
      cleanupTempHome(tmpHome);
    }
  });

  // ---------------------------------------------------------------------------
  // UserApproval (論理イベント: 同梱 WAV なし)
  // ---------------------------------------------------------------------------
  process.stdout.write(`\n${bold('[4] UserApproval logical event')}\n`);

  await test('UserApproval event exits 0 with default phrase', () => {
    const r = runNotify('UserApproval');
    assertEqual(r.status, 0, 'exit code');
    assertIncludes(r.stderr, 'event=UserApproval', 'event normalized');
    assertIncludes(r.stderr, '許可が必要よ。', 'default phrase');
  });

  await test('UserApproval has no bundled WAV (logical event only)', () => {
    const r = runNotify('UserApproval');
    assertEqual(r.status, 0, 'exit code');
    assertIncludes(
      r.stderr,
      'no bundled audio for event=UserApproval',
      'logical event log'
    );
    assertIncludes(r.stderr, 'audio=<none>', 'no audio path resolved');
  });

  await test('phrases.json userApproval overrides phrase', () => {
    const tmpHome = withTempHome({
      userApproval: 'ちょっと許可してほしいわ',
    });
    try {
      const r = runNotify('UserApproval', {
        HOME: tmpHome,
        USERPROFILE: tmpHome,
      });
      assertEqual(r.status, 0, 'exit code');
      assertIncludes(r.stderr, 'ちょっと許可してほしいわ', 'overridden phrase');
      assertIncludes(r.stderr, 'user config loaded', 'config load log');
    } finally {
      cleanupTempHome(tmpHome);
    }
  });

  // ---------------------------------------------------------------------------
  // 堅牢性
  // ---------------------------------------------------------------------------
  process.stdout.write(`\n${bold('[5] Robustness')}\n`);

  await test('No arguments → defaults to Stop, exits 0', () => {
    const r = runNotify(undefined);
    assertEqual(r.status, 0, 'exit code');
  });

  await test('Empty stdin → still exits 0', () => {
    const result = spawnSync('node', [notifyScript, 'Stop'], {
      env: { ...process.env, ZUNDAMON_DRY_RUN: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      input: '',
      timeout: 30000,
      encoding: 'utf8',
    });
    assertEqual(result.status, 0, 'exit code');
  });

  // ---------------------------------------------------------------------------
  // サマリ
  // ---------------------------------------------------------------------------
  process.stdout.write(
    `\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}\n\n`
  );

  if (failed > 0) {
    process.stdout.write(red('Failures:\n'));
    for (const f of failures) {
      process.stdout.write(`  - ${f.name}\n    ${f.error.message}\n`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(red(`\ntest runner crashed: ${e.stack || e}\n`));
  process.exit(1);
});
