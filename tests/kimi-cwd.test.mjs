import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';
import { startBackground } from '../plugins/kimi/scripts/lib/job-control.mjs';

function fakeChild() {
  return {
    stdout: { pipe: () => {} },
    stderr: { pipe: () => {} },
    unref: () => {},
    on: () => {},
    pid: 4242,
  };
}

test('startBackground spawns kimi with cwd set to the provided repoPath (worktree isolation)', async () => {
  const tmpPlugin = makeTempDir();
  const tmpRepo = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  const prevBin = process.env.KIMI_BIN;
  process.env.KIMI_PLUGIN_DATA = tmpPlugin;
  process.env.KIMI_BIN = 'kimi';

  let capturedOpts = null;
  let capturedArgs = null;
  const spawnFn = (cmd, args, opts) => {
    assert.equal(cmd, 'kimi');
    capturedArgs = args;
    capturedOpts = opts;
    return fakeChild();
  };

  try {
    await startBackground({
      sessionId: 'cwd-test-1',
      agentFile: '/fake/agent.yaml',
      prompt: 'p',
      repoPath: tmpRepo,
      spawnFn,
    });
    // kimi-code has no --work-dir: the workspace IS the spawn cwd
    // (apps/kimi-code/src/cli/run-prompt.ts: workDir = process.cwd()).
    assert.equal(capturedOpts.cwd, tmpRepo, 'spawn cwd must equal the worktree repoPath');
    assert.ok(!capturedArgs.includes('--work-dir'), 'legacy --work-dir flag must be gone');
    assert.ok(!capturedArgs.includes('--agent-file'), 'legacy --agent-file flag must be gone');
    assert.ok(!capturedArgs.includes('--yolo'), '-p mode must not pass --yolo (flag conflict in kimi-code)');
    const pIdx = capturedArgs.indexOf('-p');
    assert.ok(pIdx >= 0, '-p flag must be present');
    assert.equal(capturedArgs[pIdx + 1], 'p', '-p value must be the prompt');
    // Non-coder agent file → read-only: env must point at the ephemeral home.
    assert.ok(capturedOpts.env.KIMI_CODE_HOME.includes('kimi-home-readonly'),
      'read-only run must use the ephemeral KIMI_CODE_HOME');
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    if (prevBin === undefined) delete process.env.KIMI_BIN;
    else process.env.KIMI_BIN = prevBin;
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(tmpRepo);
  }
});

test('startBackground does NOT re-resolve repoPath when the caller provides it', async () => {
  const tmpPlugin = makeTempDir();
  const tmpRepo = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = tmpPlugin;

  let capturedOpts = null;
  const spawnFn = (cmd, args, opts) => { capturedOpts = opts; return fakeChild(); };

  try {
    const result = await startBackground({
      sessionId: 'cwd-test-2',
      agentFile: '/fake/agent.yaml',
      prompt: 'p',
      repoPath: tmpRepo,
      spawnFn,
    });
    assert.equal(result.status, 'started');
    assert.equal(capturedOpts.cwd, tmpRepo, 'must honor caller repoPath, not findRepoRoot');
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(tmpRepo);
  }
});
