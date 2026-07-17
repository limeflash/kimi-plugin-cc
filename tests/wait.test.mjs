import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';

const brokerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'plugins', 'kimi', 'scripts', 'broker.mjs',
);

function seedSession(pluginDir, id, { status, message, pid }) {
  const dir = path.join(pluginDir, 'sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    session_id: id, status, exit_code: status === 'completed' ? 0 : null,
    committed: status === 'completed', commit_sha: status === 'completed' ? 'abc123' : null,
    kimi_session_id: 'session_x',
  }));
  const lines = [];
  if (message) lines.push(JSON.stringify({ role: 'assistant', content: message }));
  fs.writeFileSync(path.join(dir, 'output.jsonl'), lines.join('\n') + (lines.length ? '\n' : ''));
  if (pid !== undefined) fs.writeFileSync(path.join(dir, 'pid'), String(pid));
}

function runBroker(args, pluginDir) {
  return new Promise((resolve) => {
    execFile(process.execPath, [brokerPath, ...args], {
      env: { ...process.env, KIMI_PLUGIN_DATA: pluginDir },
    }, (err, stdout, stderr) => resolve({ stdout, stderr, code: err?.code ?? 0 }));
  });
}

test('wait returns immediately with the result for an already-terminal session', async () => {
  const tmp = makeTempDir();
  try {
    // A dead pid → isRunning false; status completed → terminal.
    seedSession(tmp, 'wait-done', { status: 'completed', message: 'FINAL RESULT', pid: 999999999 });

    const start = Date.now();
    const res = await runBroker(['wait', '--session-id', 'wait-done', '--poll', '100'], tmp);
    const elapsed = Date.now() - start;

    const out = JSON.parse(res.stdout);
    assert.equal(out.done, true);
    assert.equal(res.code, 0, 'exit 0 when done');
    assert.equal(out.sessions[0].status, 'completed');
    assert.equal(out.sessions[0].message, 'FINAL RESULT', 'surfaces the final assistant message');
    assert.equal(out.sessions[0].committed, true);
    assert.equal(out.sessions[0].kimi_session_id, 'session_x');
    assert.ok(elapsed < 3000, `should not block for a terminal session (took ${elapsed}ms)`);
  } finally {
    cleanupTempDir(tmp);
  }
});

test('wait gives up with done:false and exit 1 when the job outlives --timeout', async () => {
  const tmp = makeTempDir();
  // A live process to stand in for the running job (isRunning checks pid liveness).
  const sleeper = (await import('node:child_process')).spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)']);
  try {
    seedSession(tmp, 'wait-running', { status: 'running', pid: sleeper.pid });

    const res = await runBroker(['wait', '--session-id', 'wait-running', '--timeout', '600', '--poll', '150'], tmp);
    const out = JSON.parse(res.stdout);
    assert.equal(out.done, false, 'not done — job still running past the timeout');
    assert.equal(out.timed_out, true);
    assert.equal(out.sessions[0].status, 'running');
    assert.equal(res.code, 1, 'exit 1 signals "still running, wait again"');
  } finally {
    sleeper.kill('SIGKILL');
    cleanupTempDir(tmp);
  }
});

test('wait accepts multiple comma-separated session ids', async () => {
  const tmp = makeTempDir();
  try {
    seedSession(tmp, 'w1', { status: 'completed', message: 'one', pid: 999999999 });
    seedSession(tmp, 'w2', { status: 'failed', message: 'two', pid: 999999999 });

    const res = await runBroker(['wait', '--session-id', 'w1,w2', '--poll', '100'], tmp);
    const out = JSON.parse(res.stdout);
    assert.equal(out.done, true, 'both terminal → done');
    assert.equal(out.sessions.length, 2);
    assert.deepEqual(out.sessions.map((s) => s.session_id).sort(), ['w1', 'w2']);
  } finally {
    cleanupTempDir(tmp);
  }
});
