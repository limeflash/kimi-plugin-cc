import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';
import { shouldCommit, commitWork } from '../plugins/kimi/scripts/lib/commit.mjs';

function initRepo() {
  const dir = makeTempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir });
  return dir;
}

function head(dir) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
}

test('shouldCommit honors policy + clean conditions', () => {
  assert.equal(shouldCommit('off', { exitCode: 0, retries: 0 }), false);
  assert.equal(shouldCommit('on', { exitCode: 1, retries: 2 }), true);
  assert.equal(shouldCommit('on-clean', { exitCode: 0, retries: 0 }), true);
  assert.equal(shouldCommit('on-clean', { exitCode: 1, retries: 0 }), false);
  assert.equal(shouldCommit('on-clean', { exitCode: 0, retries: 2 }), false);
});

test("policy 'on' commits a dirty tree and returns a 40-hex SHA", async () => {
  const dir = initRepo();
  try {
    const before = head(dir);
    fs.writeFileSync(path.join(dir, 'work.txt'), 'kimi did this\n');
    const r = await commitWork(dir, 'abcdef12-0000', { auto_commit_policy: 'on', tag: 'pilot' }, { exitCode: 0, retries: 0 });
    assert.equal(r.committed, true);
    assert.match(r.commit_sha, /^[0-9a-f]{40}$/);
    assert.notEqual(head(dir), before);
  } finally {
    cleanupTempDir(dir);
  }
});

test("policy 'on-clean' with non-zero exit does NOT commit", async () => {
  const dir = initRepo();
  try {
    const before = head(dir);
    fs.writeFileSync(path.join(dir, 'work.txt'), 'incomplete\n');
    const r = await commitWork(dir, 'abcdef12-0000', { auto_commit_policy: 'on-clean' }, { exitCode: 1, retries: 0 });
    assert.equal(r.committed, false);
    assert.equal(r.commit_sha, null);
    assert.equal(head(dir), before);
  } finally {
    cleanupTempDir(dir);
  }
});

test("policy 'off' never commits", async () => {
  const dir = initRepo();
  try {
    const before = head(dir);
    fs.writeFileSync(path.join(dir, 'work.txt'), 'x\n');
    const r = await commitWork(dir, 'abcdef12-0000', { auto_commit_policy: 'off' }, { exitCode: 0, retries: 0 });
    assert.equal(r.committed, false);
    assert.equal(head(dir), before);
  } finally {
    cleanupTempDir(dir);
  }
});

test('empty diff is a no-op even under policy on', async () => {
  const dir = initRepo();
  try {
    const before = head(dir);
    const r = await commitWork(dir, 'abcdef12-0000', { auto_commit_policy: 'on' }, { exitCode: 0, retries: 0 });
    assert.equal(r.committed, false);
    assert.match(r.reason, /no changes/);
    assert.equal(head(dir), before);
  } finally {
    cleanupTempDir(dir);
  }
});

test('touches_paths scopes the add to listed files only', async () => {
  const dir = initRepo();
  try {
    fs.writeFileSync(path.join(dir, 'in-scope.txt'), 'a\n');
    fs.writeFileSync(path.join(dir, 'out-of-scope.txt'), 'b\n');
    const r = await commitWork(dir, 'abcdef12-0000', { auto_commit_policy: 'on', touches_paths: ['in-scope.txt'] }, { exitCode: 0, retries: 0 });
    assert.equal(r.committed, true);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf-8' });
    assert.match(status, /out-of-scope\.txt/);
    assert.doesNotMatch(status, /in-scope\.txt/);
  } finally {
    cleanupTempDir(dir);
  }
});
