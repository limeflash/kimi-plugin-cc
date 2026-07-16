import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, writeRepoSession } from './workspace.mjs';
import { attachTelemetry } from './telemetry.mjs';
import { warn } from './warn.mjs';
import { updateMeta, readMeta } from './state.mjs';
import { commitWork } from './commit.mjs';
import {
  isReadOnlyAgentFile,
  prepareReadOnlyHome,
  resolveKimiBin,
  buildKimiArgs,
  buildKimiSpawnEnv,
} from './kimi-home.mjs';
import { prepareReadOnlySnapshot, cleanupSnapshot } from './snapshot.mjs';

function getPluginRoot() {
  return process.env.KIMI_PLUGIN_DATA
    ? path.join(process.env.KIMI_PLUGIN_DATA)
    : path.join(process.env.HOME, '.kimi-plugin-cc');
}

export function getSessionsDir() {
  return path.join(getPluginRoot(), 'sessions');
}

function getSupervisorPath() {
  return fileURLToPath(new URL('./supervisor.mjs', import.meta.url));
}

/**
 * Launch a background Kimi job and return IMMEDIATELY.
 *
 * The job is run by a **detached supervisor process** (supervisor.mjs), not by
 * this broker: the broker only writes the initial meta envelope, spawns the
 * supervisor, and returns. This is what makes `--background` actually
 * background — the earlier design piped the child's stdio in-process, so the
 * pipe read-handles kept the broker's event loop alive until the job finished
 * (a 3s job "returned" in 3.7s). The supervisor owns the child's lifecycle,
 * the idle watchdog, and finalization (status/commit/telemetry/cleanup).
 *
 * Tests inject `opts.spawnFn`; in that mode the supervision runs IN-PROCESS via
 * superviseJob so the fake child's close handler is observable, exactly as
 * before. Production (no spawnFn) uses the detached supervisor.
 */
export async function startBackground(opts) {
  const sessionId = opts.sessionId || crypto.randomUUID();
  const sessDir = path.join(getSessionsDir(), sessionId);
  await mkdir(sessDir, { recursive: true });

  const repoPath = opts.repoPath || await findRepoRoot();

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

  // Track as latest session for this repo before handing off.
  await writeRepoSession(repoPath, sessionId);

  // Test path: run the supervision in-process so an injected spawnFn's close
  // handler is observable. No real detachment needed.
  if (opts.spawnFn) {
    const { pid } = await superviseJob(sessionId, { spawnFn: opts.spawnFn });
    return { sessionId, status: 'started', pid };
  }

  // Production: spawn the detached supervisor and return immediately. Its stdio
  // is fully detached (nothing piped back here), so once we unref it the broker
  // holds no handles and exits — the caller is freed.
  const supervisor = spawn(process.execPath, [getSupervisorPath(), sessionId], {
    cwd: repoPath,
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
  });
  supervisor.unref();

  return { sessionId, status: 'started', pid: supervisor.pid };
}

/**
 * Run one background Kimi job to completion: spawn kimi, watch it, and finalize
 * the session (status, commit unless read-only, telemetry, snapshot cleanup).
 * Reads all job parameters from the session's meta.json, so the detached
 * supervisor needs nothing but the sessionId.
 *
 * Returns once the child has been SPAWNED (with its pid); the returned promise
 * does not wait for the child to exit. Finalization happens in the child's
 * 'close' handler, which keeps THIS process (the supervisor, or the test
 * process) alive until the job settles.
 *
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {function} [opts.spawnFn] - inject a fake spawn (tests). When set,
 *   snapshot isolation and the idle watchdog are skipped (no real process).
 * @returns {Promise<{pid: number}>}
 */
export async function superviseJob(sessionId, opts = {}) {
  const sessDir = path.join(getSessionsDir(), sessionId);
  const meta = await readMeta(sessionId);
  const repoPath = meta.repo_path || await findRepoRoot();
  const agentFile = meta.agent_file;

  // kimi-code invocation: workspace is the spawn cwd, tool policy travels via
  // KIMI_CODE_HOME (fail-closed read-only for non-coder agent files). See
  // kimi-home.mjs.
  const readOnly = isReadOnlyAgentFile(agentFile);
  const roHome = readOnly ? await prepareReadOnlyHome(getPluginRoot()) : null;
  const args = buildKimiArgs({
    prompt: meta.prompt,
    model: meta.model,
    emptySkillsDir: roHome?.emptySkillsDir,
  });
  const env = buildKimiSpawnEnv({ readOnlyHome: roHome?.homeDir });

  // Filesystem isolation (read-only backstop): kimi runs in a snapshot outside
  // the working tree. Skipped for injected spawnFn (tests) — nothing to isolate.
  let snapshot = null;
  if (readOnly && !opts.spawnFn) {
    snapshot = await prepareReadOnlySnapshot(repoPath, sessDir);
    await updateMeta(sessionId, {
      isolation: snapshot.workspaceDir ? 'snapshot' : 'in-place',
      isolation_warning: snapshot.warning || '',
    });
  }
  const effectiveCwd = snapshot?.workspaceDir || repoPath;

  const outFile = path.join(sessDir, 'output.jsonl');
  const logFile = path.join(sessDir, 'kimi.log');
  const out = createWriteStream(outFile);
  const err = createWriteStream(logFile);

  const spawnFn = opts.spawnFn || spawn;
  const child = spawnFn(resolveKimiBin(), args, {
    cwd: effectiveCwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(err);

  // The finalizer reads output.jsonl (kimi session id, telemetry). `pipe` ends
  // `out` when stdout ends, but the flush to disk is async — reading on the
  // child's 'close' event can race ahead of the last buffered line (the
  // trailing session.resume_hint), intermittently losing kimi_session_id and
  // undercounting telemetry under load. Await this before reading the file.
  const outFlushed = new Promise((resolve) => {
    out.on('close', resolve);
    out.on('error', resolve);
  });

  await writeFile(path.join(sessDir, 'pid'), String(child.pid));

  // Idle-output watchdog: if no new output for KIMI_IDLE_TIMEOUT_MS (default
  // 5m), the crank is hung — SIGTERM/SIGKILL it. (Skipped for injected spawnFn.)
  const idleMs = Number(process.env.KIMI_IDLE_TIMEOUT_MS || 5 * 60 * 1000);
  if (!opts.spawnFn && child.pid) {
    let lastOutput = Date.now();
    child.stdout.on('data', () => { lastOutput = Date.now(); });
    child.stderr.on('data', () => { lastOutput = Date.now(); });
    const idleTimer = setInterval(() => {
      if (Date.now() - lastOutput > idleMs) {
        clearInterval(idleTimer);
        try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ }
        setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }, 2000);
        updateMeta(sessionId, { timed_out: true, reason: 'idle-timeout' }).catch(() => {});
      }
    }, Math.min(idleMs, 30000));
    idleTimer.unref?.();
    child.on('close', () => clearInterval(idleTimer));
  }

  // Finalize on completion. updateMeta preserves the initial-write fields by
  // read-then-merge.
  child.on('close', async (code) => {
    try {
      // Wait for output.jsonl to finish flushing before reading it.
      await outFlushed;
      // Capture kimi-code's own session id (meta session.resume_hint) for -S.
      let kimiSessionId = '';
      try {
        const { extractKimiSessionId } = await import('./kimi.mjs');
        kimiSessionId = await extractKimiSessionId(outFile);
      } catch { /* best-effort */ }

      // A cancel may have set status='cancelled' by killing the child; don't
      // clobber that terminal state with 'failed' from the resulting signal.
      const current = await readMeta(sessionId).catch(() => ({}));
      if (current.status !== 'cancelled') {
        await updateMeta(sessionId, {
          status: code === 0 ? 'completed' : 'failed',
          exit_code: code ?? 1,
          kimi_session_id: kimiSessionId,
          finished_at: new Date().toISOString(),
        });
        // Read-only runs produce no changes of their own (they ran in a
        // snapshot outside the repo); committing here would sweep the user's
        // pre-existing uncommitted work into a "kimi session" commit. Never.
        if (readOnly) {
          await updateMeta(sessionId, { committed: false, commit_reason: 'read-only session: never commits' });
        } else {
          try {
            const m = await readMeta(sessionId);
            const c = await commitWork(repoPath, sessionId, m, { exitCode: code ?? 1, retries: 0 });
            await updateMeta(sessionId, { committed: c.committed, commit_sha: c.commit_sha, commit_reason: c.reason });
          } catch (e) {
            await warn('commit', e, 'warning');
          }
        }
      }
      await attachTelemetry(sessionId, getSessionsDir());
      if (!process.env.KIMI_KEEP_SNAPSHOT) await cleanupSnapshot(snapshot?.workspaceDir);
    } catch (e) {
      await warn('job-control', e, 'error');
    }
  });

  return { pid: child.pid };
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
