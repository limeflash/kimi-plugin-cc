import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brokerPath = path.join(__dirname, '..', 'plugins', 'kimi', 'scripts', 'broker.mjs');

test('broker usage message lists all subcommands', async () => {
  const result = await new Promise((resolve) => {
    execFile('node', [brokerPath], (err, stdout, stderr) => {
      resolve({ stdout, stderr, code: err ? err.code : 0 });
    });
  });

  const text = result.stdout || result.stderr;
  assert.ok(text.includes('dispatch'), 'usage mentions dispatch');
  assert.ok(text.includes('status'), 'usage mentions status');
  assert.ok(text.includes('result'), 'usage mentions result');
  assert.ok(text.includes('cancel'), 'usage mentions cancel');
  assert.ok(text.includes('diff-capture'), 'usage mentions diff-capture');
  assert.ok(text.includes('watch'), 'usage mentions watch');
  assert.ok(text.includes('report'), 'usage mentions report');
  assert.ok(text.includes('telemetry'), 'usage mentions telemetry');
  assert.ok(text.includes('checkpoint'), 'usage mentions checkpoint');
  assert.ok(text.includes('monitor'), 'usage mentions monitor');
  assert.ok(text.includes('warnings'), 'usage mentions warnings');
  assert.ok(text.includes('batch'), 'usage mentions batch');
  assert.ok(text.includes('next'), 'usage mentions next');
});

test('broker dispatch --help-ish exits with usage', async () => {
  const result = await new Promise((resolve) => {
    execFile('node', [brokerPath, 'unknown-cmd'], (err, stdout, stderr) => {
      resolve({ stdout, stderr, exited: !!err });
    });
  });
  assert.ok(result.exited, 'unknown command exits');
});

test('broker dispatch preserves a --prompt value that starts with dashes (YAML frontmatter)', async () => {
  // Regression: parseArgs used `next.startsWith('--')` to detect the next
  // option, so a prompt beginning with `---` (task-file frontmatter) was
  // swallowed and dispatch shipped the literal string "true" to kimi.
  const fs = await import('node:fs');
  const os = await import('node:os');
  const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-plugin-test-'));
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-plugin-test-'));
  const frontmatterPrompt = '---\nid: T-1\n---\n# Task\nCreate hello.txt';

  const result = await new Promise((resolve) => {
    execFile('node', [brokerPath, 'dispatch',
      '--prompt', frontmatterPrompt,
      '--agent-file', '/fake/agent.yaml',
      '--mode', 'explore',
    ], {
      cwd: tmpRepo,
      env: {
        ...process.env,
        KIMI_PLUGIN_DATA: tmpPlugin,
        // Nonexistent binary: the spawn fails fast (exit 1) but meta.json is
        // written first, which is all this regression needs.
        KIMI_BIN: path.join(tmpPlugin, 'kimi-definitely-missing'),
        KIMI_CODE_USER_HOME: tmpPlugin,
      },
    }, (err, stdout, stderr) => resolve({ stdout, stderr, code: err?.code ?? 0 }));
  });

  try {
    const out = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.notEqual(out.reason, 'invalid-prompt', 'frontmatter prompt must be accepted as a string');
    const sessions = fs.readdirSync(path.join(tmpPlugin, 'sessions'));
    assert.equal(sessions.length, 1);
    const meta = JSON.parse(fs.readFileSync(path.join(tmpPlugin, 'sessions', sessions[0], 'meta.json'), 'utf-8'));
    assert.equal(meta.prompt, frontmatterPrompt, 'meta must carry the full prompt string, not true');
  } finally {
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('broker dispatch rejects a swallowed/missing --prompt with invalid-prompt', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-plugin-test-'));

  const result = await new Promise((resolve) => {
    // --prompt directly followed by another option → parses as boolean true.
    execFile('node', [brokerPath, 'dispatch',
      '--prompt',
      '--agent-file', '/fake/agent.yaml',
    ], {
      env: { ...process.env, KIMI_PLUGIN_DATA: tmpPlugin },
    }, (err, stdout, stderr) => resolve({ stdout, stderr, code: err?.code ?? 0 }));
  });

  try {
    assert.equal(result.code, 1, 'must exit 1');
    const out = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.equal(out.reason, 'invalid-prompt');
  } finally {
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
  }
});

test('broker result honors KIMI_PLUGIN_DATA (was hardcoded to ~/.kimi-plugin-cc)', async () => {
  // Regression: cmdResult read ~/.kimi-plugin-cc/sessions/<id> directly instead
  // of getSessionsDir(), so `result` reported "No output captured yet" for a
  // completed session whenever KIMI_PLUGIN_DATA was overridden (status and
  // latest-session, which use getSessionsDir, worked — a confusing split).
  const fs = await import('node:fs');
  const os = await import('node:os');
  const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-plugin-test-'));
  const sessionId = 'result-path-1';
  const sessDir = path.join(tmpPlugin, 'sessions', sessionId);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessDir, 'output.jsonl'),
    [
      JSON.stringify({ role: 'assistant', tool_calls: [{ type: 'function', id: 't', function: { name: 'Read', arguments: '{}' } }] }),
      JSON.stringify({ role: 'tool', tool_call_id: 't', content: 'ok' }),
      JSON.stringify({ role: 'assistant', content: 'THE FINAL ANSWER' }),
      JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: 'session_x' }),
    ].join('\n') + '\n',
  );

  const result = await new Promise((resolve) => {
    execFile('node', [brokerPath, 'result', '--session-id', sessionId], {
      env: { ...process.env, KIMI_PLUGIN_DATA: tmpPlugin },
    }, (err, stdout, stderr) => resolve({ stdout, stderr, code: err?.code ?? 0 }));
  });

  try {
    assert.equal(result.code, 0, 'must exit 0');
    assert.match(result.stdout, /THE FINAL ANSWER/, 'must print the last assistant message');
    assert.doesNotMatch(result.stdout, /No output captured/, 'must not report missing output');
  } finally {
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
  }
});
