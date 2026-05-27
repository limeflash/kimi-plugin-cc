import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';
import {
  captureDiff,
  getBranchDiff,
  getWorkingDiff,
  findRepoRoot,
} from '../plugins/kimi/scripts/lib/git.mjs';

function initGitRepo(dir) {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

test('findRepoRoot finds git repo root', async () => {
  const tmp = makeTempDir();
  try {
    initGitRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'));
    const root = await findRepoRoot(path.join(tmp, 'src'));
    assert.equal(root, fs.realpathSync(tmp));
  } finally {
    cleanupTempDir(tmp);
  }
});

test('findRepoRoot returns start when not in git repo', async () => {
  const tmp = makeTempDir();
  try {
    const root = await findRepoRoot(tmp);
    assert.equal(root, tmp);
  } finally {
    cleanupTempDir(tmp);
  }
});

test('getWorkingDiff returns empty when no changes', async () => {
  const tmp = makeTempDir();
  try {
    initGitRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmp });
    const diff = await getWorkingDiff(tmp);
    assert.equal(diff.trim(), '');
  } finally {
    cleanupTempDir(tmp);
  }
});

test('getWorkingDiff returns diff for uncommitted changes', async () => {
  const tmp = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = makeTempDir();

  try {
    initGitRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello world');
    const diff = await getWorkingDiff(tmp);
    assert.match(diff, /hello world/);
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmp);
  }
});

test('captureDiff writes diff and status files', async () => {
  const tmp = makeTempDir();
  const pluginData = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = pluginData;

  try {
    initGitRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello world');

    await captureDiff('sess-cap', 'pre', tmp);

    const diffPath = path.join(pluginData, 'sessions', 'sess-cap', 'pre.diff');
    const statusPath = path.join(pluginData, 'sessions', 'sess-cap', 'pre.status');
    assert.equal(fs.existsSync(diffPath), true);
    assert.equal(fs.existsSync(statusPath), true);
    const diff = fs.readFileSync(diffPath, 'utf-8');
    assert.match(diff, /hello world/);
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmp);
    cleanupTempDir(pluginData);
  }
});
