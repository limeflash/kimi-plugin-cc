import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { findRepoRoot, writeRepoSession } from './workspace.mjs';
import { attachTelemetry } from './telemetry.mjs';
import { warn } from './warn.mjs';
import { updateMeta } from './state.mjs';

function getPluginRoot() {
  return process.env.KIMI_PLUGIN_DATA
    ? path.join(process.env.KIMI_PLUGIN_DATA)
    : path.join(process.env.HOME, '.kimi-plugin-cc');
}

export function getSessionsDir() {
  return path.join(getPluginRoot(), 'sessions');
}

export async function startBackground(opts) {
  const sessionId = opts.sessionId || crypto.randomUUID();
  const sessDir = path.join(getSessionsDir(), sessionId);
  await mkdir(sessDir, { recursive: true });

  const repoPath = await findRepoRoot();

  const meta = {
    session_id: sessionId,
    agent_file: opts.agentFile,
    prompt: opts.prompt,
    model: opts.model || '',
    started_at: new Date().toISOString(),
    status: 'running',
    repo_path: repoPath,
    mode: opts.mode || 'crank',
    auto_commit_policy: opts.autoCommitPolicy || 'on-clean',
    tag: opts.tag || '',
    touches_paths: opts.touchesPaths || [],
    baseline_sha: opts.baselineSha || '',
  };
  await writeFile(path.join(sessDir, 'meta.json'), JSON.stringify(meta, null, 2));

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--agent-file', opts.agentFile,
  ];
  if (opts.model) args.push('--model', opts.model);
  args.push('-p', opts.prompt);

  const outFile = path.join(sessDir, 'output.jsonl');
  const logFile = path.join(sessDir, 'kimi.log');
  const out = createWriteStream(outFile);
  const err = createWriteStream(logFile);

  const spawnFn = opts.spawnFn || spawn;
  const child = spawnFn('kimi', args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  child.unref();

  await writeFile(path.join(sessDir, 'pid'), String(child.pid));

  // Track as latest session for this repo
  await writeRepoSession(repoPath, sessionId);

  // Watch for completion and update meta + telemetry.
  // updateMeta preserves the 12 initial-write fields (session_id, agent_file,
  // prompt, model, started_at, repo_path, mode, auto_commit_policy, tag,
  // touches_paths, baseline_sha) by reading-then-merging.
  child.on('close', async (code) => {
    try {
      await updateMeta(sessionId, {
        status: code === 0 ? 'completed' : 'failed',
        exit_code: code ?? 1,
        finished_at: new Date().toISOString(),
      });
      await attachTelemetry(sessionId, getSessionsDir());
    } catch (e) {
      await warn('job-control', e, 'error');
    }
  });

  return { sessionId, status: 'started', pid: child.pid };
}

export async function cancelSession(sessionId) {
  const sessionsDir = getSessionsDir();
  const pidFile = path.join(sessionsDir, sessionId, 'pid');
  try {
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 1000));
    try { process.kill(pid, 'SIGKILL'); } catch {}
  } catch {
    // no pid file
  }

  // Checkpoint: stash touched files if any
  await stashCheckpoint(sessionId);

  try {
    await updateMeta(sessionId, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });
  } catch (e) {
    await warn('job-control', e, 'error');
  }

  return { sessionId, status: 'cancelled' };
}

async function stashCheckpoint(sessionId) {
  const sessionsDir = getSessionsDir();
  let meta;
  try {
    meta = JSON.parse(await readFile(path.join(sessionsDir, sessionId, 'meta.json'), 'utf-8'));
  } catch (e) {
    await warn('job-control', e, 'warning');
    return;
  }
  const repoPath = meta.repo_path;
  const touches = meta.touches_paths || [];
  if (!repoPath || touches.length === 0) return;

  const checkpointDir = path.join(repoPath, '.kimi', 'state', 'checkpoints');
  await mkdir(checkpointDir, { recursive: true });

  try {
    const { execFile } = await import('node:child_process');
    const diff = await new Promise((resolve) => {
      execFile('git', ['diff', '--', ...touches], { cwd: repoPath, encoding: 'utf-8' }, (err, stdout) => {
        resolve(stdout || '');
      });
    });
    if (!diff.trim()) return;

    const patchFile = path.join(checkpointDir, `${sessionId}.patch`);
    await writeFile(patchFile, diff);

    const checkpointMeta = {
      session_id: sessionId,
      created_at: new Date().toISOString(),
      touches_paths: touches,
      patch_file: patchFile,
    };
    await writeFile(
      path.join(checkpointDir, `${sessionId}.json`),
      JSON.stringify(checkpointMeta, null, 2)
    );
  } catch (e) {
    await warn('job-control', e, 'warning');
  }
}

export async function listCheckpoints(repoPath) {
  const checkpointDir = path.join(repoPath, '.kimi', 'state', 'checkpoints');
  const checkpoints = [];
  try {
    const files = await readdir(checkpointDir);
    for (const f of files) {
      if (f.endsWith('.json')) {
        const data = JSON.parse(await readFile(path.join(checkpointDir, f), 'utf-8'));
        checkpoints.push(data);
      }
    }
  } catch {
    // none
  }
  return checkpoints.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function restoreCheckpoint(sessionId, repoPath) {
  const checkpointDir = path.join(repoPath, '.kimi', 'state', 'checkpoints');
  const patchFile = path.join(checkpointDir, `${sessionId}.patch`);
  try {
    const { execFile } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      execFile('git', ['apply', patchFile], { cwd: repoPath }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
    return { ok: true, sessionId };
  } catch (e) {
    return { ok: false, sessionId, error: e.message };
  }
}
