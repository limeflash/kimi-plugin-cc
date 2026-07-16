import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';

const brokerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'plugins', 'kimi', 'scripts', 'broker.mjs',
);
const coderAgent = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'plugins', 'kimi', 'agent-files', 'coder.yaml',
);

function writeShim(dir, sleepSeconds) {
  const shim = path.join(dir, 'kimi');
  fs.writeFileSync(
    shim,
    `#!/usr/bin/env bash\n` +
    `echo '{"role":"assistant","content":"shim"}'\n` +
    `echo '{"role":"meta","type":"session.resume_hint","session_id":"session_shim"}'\n` +
    `sleep ${sleepSeconds}\n`,
  );
  fs.chmodSync(shim, 0o755);
  return shim;
}

// Regression for the bug where `dispatch --background` piped the child's stdio
// in-process, so the broker's event loop stayed alive until the job finished —
// a 3s job "returned" in ~3.7s. The detached supervisor must let the broker
// return immediately while the job runs on.
test('dispatch --background returns immediately (does not block on the job)', async () => {
  const tmpPlugin = makeTempDir();
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const shim = writeShim(binDir, 3); // child runs for 3s

  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
  fs.writeFileSync(path.join(repo, 'x'), 'x\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'init']);

  const start = Date.now();
  const out = await new Promise((resolve) => {
    execFile(process.execPath, [brokerPath, 'dispatch',
      '--prompt', 'hi',
      '--agent-file', coderAgent,
      '--mode', 'crank',
      '--background',
    ], {
      cwd: repo,
      env: { ...process.env, KIMI_PLUGIN_DATA: tmpPlugin, KIMI_BIN: shim },
    }, (err, stdout) => resolve(stdout));
  });
  const elapsed = Date.now() - start;

  const result = JSON.parse(out.trim().split('\n').pop());

  try {
    assert.equal(result.status, 'started', 'returns a started envelope');
    assert.ok(result.sessionId, 'returns a session id');
    // The child sleeps 3000ms; a truly-detached background must return in a
    // fraction of that. Generous bound (1500ms) to stay stable under CI load.
    assert.ok(elapsed < 1500, `broker must return before the job finishes (took ${elapsed}ms, child sleeps 3000ms)`);

    // Right after return the job is still running.
    const meta = JSON.parse(fs.readFileSync(path.join(tmpPlugin, 'sessions', result.sessionId, 'meta.json'), 'utf-8'));
    assert.equal(meta.status, 'running', 'job is still running right after --background returns');
  } finally {
    // Let the detached supervisor finish before removing its working dirs so it
    // doesn't error mid-write (best-effort — it lives in temp dirs anyway).
    await new Promise((r) => setTimeout(r, 3500));
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(repo);
    cleanupTempDir(binDir);
  }
});

// The detached supervisor must finalize the session (status/exit/commit/kimi id)
// after the broker has already returned.
test('detached supervisor finalizes the session after the broker exits', async () => {
  const tmpPlugin = makeTempDir();
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const shim = writeShim(binDir, 1); // short job

  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
  fs.writeFileSync(path.join(repo, 'x'), 'x\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'init']);
  // A produced change so the coder commit has something to record.
  fs.writeFileSync(path.join(repo, 'produced.txt'), 'work\n');

  const out = await new Promise((resolve) => {
    execFile(process.execPath, [brokerPath, 'dispatch',
      '--prompt', 'hi',
      '--agent-file', coderAgent,
      '--mode', 'crank',
      '--background',
    ], {
      cwd: repo,
      env: { ...process.env, KIMI_PLUGIN_DATA: tmpPlugin, KIMI_BIN: shim },
    }, (err, stdout) => resolve(stdout));
  });
  const { sessionId } = JSON.parse(out.trim().split('\n').pop());

  try {
    // Poll for the supervisor to finalize (it runs after the broker exited).
    let meta;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      meta = JSON.parse(fs.readFileSync(path.join(tmpPlugin, 'sessions', sessionId, 'meta.json'), 'utf-8'));
      if (meta.status === 'completed' || meta.status === 'failed') break;
    }
    assert.equal(meta.status, 'completed', 'supervisor marks the session completed');
    assert.equal(meta.exit_code, 0);
    assert.equal(meta.kimi_session_id, 'session_shim', 'supervisor captured the kimi session id');
    assert.equal(meta.committed, true, 'coder job commits its produced work');
  } finally {
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(repo);
    cleanupTempDir(binDir);
  }
});
