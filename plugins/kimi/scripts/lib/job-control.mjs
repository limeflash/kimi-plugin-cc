import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { findRepoRoot, writeRepoSession } from './workspace.mjs';

const KIMI_PLUGIN_ROOT = path.join(process.env.HOME, '.kimi-plugin-cc');
const SESSIONS_DIR = path.join(KIMI_PLUGIN_ROOT, 'sessions');

export async function startBackground(opts) {
  const sessionId = opts.sessionId || crypto.randomUUID();
  const sessDir = path.join(SESSIONS_DIR, sessionId);
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

  const child = spawn('kimi', args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  child.unref();

  await writeFile(path.join(sessDir, 'pid'), String(child.pid));

  // Track as latest session for this repo
  await writeRepoSession(repoPath, sessionId);

  // Watch for completion and update meta
  child.on('close', async (code) => {
    try {
      const m = JSON.parse(await readFile(path.join(sessDir, 'meta.json'), 'utf-8'));
      m.status = code === 0 ? 'completed' : 'failed';
      m.exit_code = code ?? 1;
      m.finished_at = new Date().toISOString();
      await writeFile(path.join(sessDir, 'meta.json'), JSON.stringify(m, null, 2));
    } catch {
      // ignore
    }
  });

  return { sessionId, status: 'started', pid: child.pid };
}

export async function cancelSession(sessionId) {
  const pidFile = path.join(SESSIONS_DIR, sessionId, 'pid');
  try {
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 1000));
    try { process.kill(pid, 'SIGKILL'); } catch {}
  } catch {
    // no pid file
  }

  const metaPath = path.join(SESSIONS_DIR, sessionId, 'meta.json');
  try {
    const m = JSON.parse(await readFile(metaPath, 'utf-8'));
    m.status = 'cancelled';
    m.cancelled_at = new Date().toISOString();
    await writeFile(metaPath, JSON.stringify(m, null, 2));
  } catch {
    // ignore
  }

  return { sessionId, status: 'cancelled' };
}
