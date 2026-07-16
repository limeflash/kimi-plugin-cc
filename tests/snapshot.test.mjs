import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';
import { prepareReadOnlySnapshot, cleanupSnapshot } from '../plugins/kimi/scripts/lib/snapshot.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function makeRepo() {
  const repo = makeTempDir();
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  return repo;
}

test('snapshot carries HEAD + uncommitted changes + untracked, excludes ignored', async () => {
  const repo = makeRepo();
  const sessDir = makeTempDir();
  try {
    fs.writeFileSync(path.join(repo, 'committed.txt'), 'v1\n');
    fs.writeFileSync(path.join(repo, 'modified.txt'), 'old\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'secret.env\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');

    fs.writeFileSync(path.join(repo, 'modified.txt'), 'NEW CONTENT\n'); // unstaged edit
    fs.mkdirSync(path.join(repo, 'sub'));
    fs.writeFileSync(path.join(repo, 'sub', 'untracked.txt'), 'brand new\n'); // untracked
    fs.writeFileSync(path.join(repo, 'secret.env'), 'API_KEY=hunter2\n'); // ignored

    const { workspaceDir, warning } = await prepareReadOnlySnapshot(repo, sessDir);
    assert.ok(workspaceDir, 'snapshot must be built for a git repo');
    assert.equal(warning, '');

    assert.equal(fs.readFileSync(path.join(workspaceDir, 'committed.txt'), 'utf-8'), 'v1\n');
    assert.equal(fs.readFileSync(path.join(workspaceDir, 'modified.txt'), 'utf-8'), 'NEW CONTENT\n',
      'uncommitted edits must be visible in the snapshot');
    assert.equal(fs.readFileSync(path.join(workspaceDir, 'sub', 'untracked.txt'), 'utf-8'), 'brand new\n',
      'untracked files must be copied in');
    assert.ok(!fs.existsSync(path.join(workspaceDir, 'secret.env')),
      'gitignored files must NOT reach the snapshot');
    assert.ok(!fs.existsSync(path.join(workspaceDir, '.git')),
      'snapshot must not contain .git');
  } finally {
    cleanupTempDir(repo);
    cleanupTempDir(sessDir);
  }
});

test('snapshot reflects deletions from the working tree', async () => {
  const repo = makeRepo();
  const sessDir = makeTempDir();
  try {
    fs.writeFileSync(path.join(repo, 'keep.txt'), 'keep\n');
    fs.writeFileSync(path.join(repo, 'gone.txt'), 'gone\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');
    fs.rmSync(path.join(repo, 'gone.txt'));

    const { workspaceDir } = await prepareReadOnlySnapshot(repo, sessDir);
    assert.ok(fs.existsSync(path.join(workspaceDir, 'keep.txt')));
    assert.ok(!fs.existsSync(path.join(workspaceDir, 'gone.txt')),
      'a file deleted in the working tree must be absent from the snapshot');
  } finally {
    cleanupTempDir(repo);
    cleanupTempDir(sessDir);
  }
});

test('writes inside the snapshot never touch the real repo (the backstop)', async () => {
  const repo = makeRepo();
  const sessDir = makeTempDir();
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');

    const { workspaceDir } = await prepareReadOnlySnapshot(repo, sessDir);
    fs.writeFileSync(path.join(workspaceDir, 'EVIL.txt'), 'should stay here\n');
    fs.writeFileSync(path.join(workspaceDir, 'a.txt'), 'tampered\n');

    assert.ok(!fs.existsSync(path.join(repo, 'EVIL.txt')));
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8'), 'a\n');
    assert.equal(git(repo, 'status', '--porcelain').trim(), '', 'real repo must stay clean');
  } finally {
    cleanupTempDir(repo);
    cleanupTempDir(sessDir);
  }
});

test('non-git directory degrades to in-place with a warning (deny rules remain)', async () => {
  const plainDir = makeTempDir();
  const sessDir = makeTempDir();
  try {
    const { workspaceDir, warning } = await prepareReadOnlySnapshot(plainDir, sessDir);
    assert.equal(workspaceDir, null);
    assert.match(warning, /not a git repo/);
  } finally {
    cleanupTempDir(plainDir);
    cleanupTempDir(sessDir);
  }
});

test('git repo with no commits degrades to in-place with a warning', async () => {
  const repo = makeRepo(); // init only, unborn HEAD
  const sessDir = makeTempDir();
  try {
    fs.writeFileSync(path.join(repo, 'x.txt'), 'x\n');
    const { workspaceDir, warning } = await prepareReadOnlySnapshot(repo, sessDir);
    assert.equal(workspaceDir, null);
    assert.match(warning, /not a git repo|no commits/);
  } finally {
    cleanupTempDir(repo);
    cleanupTempDir(sessDir);
  }
});

test('cleanupSnapshot removes the workspace but refuses non-workspace paths', async () => {
  const repo = makeRepo();
  const sessDir = makeTempDir();
  const innocent = makeTempDir();
  try {
    fs.writeFileSync(path.join(repo, 'f.txt'), 'f\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');

    const { workspaceDir } = await prepareReadOnlySnapshot(repo, sessDir);
    await cleanupSnapshot(workspaceDir);
    assert.ok(!fs.existsSync(workspaceDir));

    fs.writeFileSync(path.join(innocent, 'precious.txt'), 'do not delete\n');
    await cleanupSnapshot(innocent); // basename is not "workspace" → refuse
    assert.ok(fs.existsSync(path.join(innocent, 'precious.txt')),
      'cleanup must refuse paths not named workspace');
  } finally {
    cleanupTempDir(repo);
    cleanupTempDir(sessDir);
    cleanupTempDir(innocent);
  }
});

test('snapshot regenerates cleanly for a reused session dir', async () => {
  const repo = makeRepo();
  const sessDir = makeTempDir();
  try {
    fs.writeFileSync(path.join(repo, 'f.txt'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');

    const first = await prepareReadOnlySnapshot(repo, sessDir);
    fs.writeFileSync(path.join(first.workspaceDir, 'stale.txt'), 'stale\n');

    const second = await prepareReadOnlySnapshot(repo, sessDir);
    assert.equal(second.workspaceDir, first.workspaceDir);
    assert.ok(!fs.existsSync(path.join(second.workspaceDir, 'stale.txt')),
      'a rebuilt snapshot must not carry leftovers from the previous one');
  } finally {
    cleanupTempDir(repo);
    cleanupTempDir(sessDir);
  }
});
