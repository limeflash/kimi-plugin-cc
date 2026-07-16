import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';
import { startBackground } from '../plugins/kimi/scripts/lib/job-control.mjs';
import { readMeta } from '../plugins/kimi/scripts/lib/state.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function fakeSpawn(exitCode = 0) {
  return () => ({
    stdout: { pipe: (dest) => dest.end() },
    stderr: { pipe: () => {} },
    unref: () => {},
    on: (event, cb) => { if (event === 'close') setTimeout(() => cb(exitCode), 20); },
    pid: 4242,
  });
}

// Regression: a read-only run (explore/review/challenge/plan) must NEVER commit.
// It produces no changes of its own, so commitWork's default `git add -A` would
// sweep the user's PRE-EXISTING uncommitted work into a "kimi session" commit.
test('read-only agent file never commits the user working tree', async () => {
  const tmpPlugin = makeTempDir();
  const repo = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  const prevBin = process.env.KIMI_BIN;
  process.env.KIMI_PLUGIN_DATA = tmpPlugin;
  process.env.KIMI_BIN = 'kimi';

  try {
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');
    const headBefore = git(repo, 'rev-parse', 'HEAD').trim();

    // Dirty tree: the user's own uncommitted work.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'user-edit\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'user note\n');

    await startBackground({
      sessionId: 'ro-nocommit-1',
      agentFile: path.join('/x/agent-files/explore.yaml'), // read-only selector
      prompt: 'explore',
      repoPath: repo,
      spawnFn: fakeSpawn(0),
    });
    await new Promise((r) => setTimeout(r, 200));

    const meta = await readMeta('ro-nocommit-1');
    assert.equal(meta.committed, false, 'read-only run must not commit');
    assert.match(meta.commit_reason || '', /read-only/i);

    assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), headBefore,
      'HEAD must not move — no new commit');
    const status = git(repo, 'status', '--porcelain');
    assert.match(status, /a\.txt/, 'user edit must remain uncommitted');
    assert.match(status, /untracked\.txt/, 'user untracked file must remain uncommitted');
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    if (prevBin === undefined) delete process.env.KIMI_BIN;
    else process.env.KIMI_BIN = prevBin;
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(repo);
  }
});

// The full-access crank still commits (its whole purpose is to land changes).
test('coder agent file still commits produced work', async () => {
  const tmpPlugin = makeTempDir();
  const repo = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  const prevBin = process.env.KIMI_BIN;
  process.env.KIMI_PLUGIN_DATA = tmpPlugin;
  process.env.KIMI_BIN = 'kimi';

  try {
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');
    const headBefore = git(repo, 'rev-parse', 'HEAD').trim();

    // A "crank result": the spawn mock leaves a change in the tree (real kimi
    // would; here we simulate the produced diff before the close handler fires).
    fs.writeFileSync(path.join(repo, 'produced.txt'), 'kimi wrote this\n');

    await startBackground({
      sessionId: 'coder-commit-1',
      agentFile: path.join('/x/agent-files/coder.yaml'), // full-access selector
      prompt: 'do work',
      repoPath: repo,
      spawnFn: fakeSpawn(0),
    });
    await new Promise((r) => setTimeout(r, 200));

    const meta = await readMeta('coder-commit-1');
    assert.equal(meta.committed, true, 'coder run must commit its work');
    assert.notEqual(git(repo, 'rev-parse', 'HEAD').trim(), headBefore, 'HEAD must advance');
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    if (prevBin === undefined) delete process.env.KIMI_BIN;
    else process.env.KIMI_BIN = prevBin;
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(repo);
  }
});
