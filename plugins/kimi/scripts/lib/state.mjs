import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const KIMI_PLUGIN_ROOT = path.join(process.env.HOME, '.kimi-plugin-cc');
const SESSIONS_DIR = path.join(KIMI_PLUGIN_ROOT, 'sessions');

export async function initSessionDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

export async function writeMeta(sessionId, meta) {
  const sessDir = path.join(SESSIONS_DIR, sessionId);
  await mkdir(sessDir, { recursive: true });
  await writeFile(path.join(sessDir, 'meta.json'), JSON.stringify(meta, null, 2));
}

export async function readMeta(sessionId) {
  const file = path.join(SESSIONS_DIR, sessionId, 'meta.json');
  const data = await readFile(file, 'utf-8');
  return JSON.parse(data);
}

export async function updateMeta(sessionId, patch) {
  const meta = await readMeta(sessionId);
  Object.assign(meta, patch);
  await writeMeta(sessionId, meta);
}

export async function listSessions() {
  try {
    const dirs = await readdir(SESSIONS_DIR);
    const sessions = [];
    for (const id of dirs) {
      const metaPath = path.join(SESSIONS_DIR, id, 'meta.json');
      try {
        const s = await stat(metaPath);
        if (s.isFile()) {
          const meta = await readMeta(id);
          meta.running = await isRunning(id);
          sessions.push(meta);
        }
      } catch {
        // ignore missing meta
      }
    }
    return sessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  } catch {
    return [];
  }
}

export async function isRunning(sessionId) {
  const pidFile = path.join(SESSIONS_DIR, sessionId, 'pid');
  try {
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getLatestSessionForRepo(repoPath) {
  const sessions = await listSessions();
  const normalized = path.resolve(repoPath);
  for (const s of sessions) {
    if (s.repo_path === normalized) {
      return s;
    }
  }
  return sessions[0] ?? null;
}
