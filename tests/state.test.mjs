import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';
import {
  initSessionDir,
  writeMeta,
  readMeta,
  updateMeta,
  listSessions,
  isRunning,
  getLatestSessionForRepo,
} from '../plugins/kimi/scripts/lib/state.mjs';

test('initSessionDir creates the sessions directory', async () => {
  const tmp = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = tmp;

  try {
    await initSessionDir();
    assert.equal(fs.existsSync(path.join(tmp, 'sessions')), true);
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmp);
  }
});

test('writeMeta and readMeta round-trip', async () => {
  const tmp = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = tmp;

  try {
    const meta = { session_id: 'sess-1', status: 'running', started_at: new Date().toISOString() };
    await writeMeta('sess-1', meta);
    const read = await readMeta('sess-1');
    assert.deepEqual(read, meta);
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmp);
  }
});

test('updateMeta merges patches', async () => {
  const tmp = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = tmp;

  try {
    await writeMeta('sess-2', { status: 'running' });
    await updateMeta('sess-2', { status: 'completed', finished_at: '2026-01-01T00:00:00Z' });
    const read = await readMeta('sess-2');
    assert.equal(read.status, 'completed');
    assert.equal(read.finished_at, '2026-01-01T00:00:00Z');
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmp);
  }
});

test('listSessions returns sorted sessions', async () => {
  const tmp = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = tmp;

  try {
    await writeMeta('sess-a', { started_at: '2026-01-01T10:00:00Z' });
    await writeMeta('sess-b', { started_at: '2026-01-01T12:00:00Z' });
    const sessions = await listSessions();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].session_id || sessions[0].started_at, sessions[0].started_at);
    // Newest first
    assert.equal(new Date(sessions[0].started_at) >= new Date(sessions[1].started_at), true);
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmp);
  }
});

test('isRunning returns false for non-existent session', async () => {
  const tmp = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = tmp;

  try {
    const running = await isRunning('nonexistent');
    assert.equal(running, false);
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmp);
  }
});

test('getLatestSessionForRepo finds matching repo', async () => {
  const tmp = makeTempDir();
  const prevEnv = process.env.KIMI_PLUGIN_DATA;
  process.env.KIMI_PLUGIN_DATA = tmp;

  try {
    const repoPath = path.resolve('/fake/repo');
    await writeMeta('sess-repo', { repo_path: repoPath, started_at: '2026-01-01T10:00:00Z' });
    const found = await getLatestSessionForRepo('/fake/repo');
    assert.notEqual(found, null);
  } finally {
    process.env.KIMI_PLUGIN_DATA = prevEnv;
    cleanupTempDir(tmp);
  }
});
