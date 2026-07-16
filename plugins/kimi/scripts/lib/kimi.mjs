import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { scanTextForSecrets } from './secrets.mjs';
import {
  isReadOnlyAgentFile,
  prepareReadOnlyHome,
  resolveKimiBin,
  buildKimiArgs,
  buildKimiSpawnEnv,
} from './kimi-home.mjs';
import { prepareReadOnlySnapshot, cleanupSnapshot } from './snapshot.mjs';

/**
 * Wrap the local `kimi` CLI (kimi-code, the TypeScript rewrite, >= 0.26.0)
 * with watchdogs and JSONL capture. See kimi-home.mjs for the invocation
 * contract and the read-only enforcement model.
 */

function getPluginRoot() {
  return process.env.KIMI_PLUGIN_DATA
    ? path.join(process.env.KIMI_PLUGIN_DATA)
    : path.join(process.env.HOME, '.kimi-plugin-cc');
}

/**
 * Invoke kimi-code non-interactively (`kimi -p`) with structured output capture.
 *
 * The legacy agent-file path doubles as the policy selector: coder*.yaml runs
 * with full tool access under the user's real KIMI_CODE_HOME; every other
 * agent file (explore, plan, unknown) runs read-only under the ephemeral home
 * with the fail-closed deny rule (see kimi-home.mjs).
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.agentFile - legacy agent YAML path, used as the policy selector
 * @param {string} [opts.model] - kimi-code model alias (config.toml `models` key)
 * @param {string} [opts.sessionId] - plugin session id (NOT the kimi-code session id)
 * @param {string} [opts.kimiSessionId] - kimi-code session id to resume with -S
 * @param {boolean} [opts.background=false]
 * @param {string} [opts.cwd] - working directory for the kimi process (e.g. an isolated worktree). Defaults to process.cwd().
 * @param {string} [opts.outputFile] - where to write JSONL (defaults to session dir)
 * @returns {Promise<{sessionId: string, exitCode: number, retries: number, outputFile: string, finalMessage?: string, kimiSessionId?: string}>}
 */
export async function invokeKimi(opts) {
  // Refuse to ship a prompt carrying a credential to the provider (Moonshot/
  // Kimi is a third party). The assembled prompt includes review diffs and the
  // CLAUDE.md/AGENTS.md context preamble, which can contain secrets.
  const secretHits = scanTextForSecrets(opts.prompt);
  if (secretHits.length && !process.env.KIMI_ALLOW_SECRETS) {
    throw new Error(
      `refusing to send prompt to kimi: possible secret(s) detected — ${secretHits.join(', ')}. ` +
      'Remove them, or set KIMI_ALLOW_SECRETS=1 to override.'
    );
  }
  const sessionId = opts.sessionId || crypto.randomUUID();
  const sessDir = path.join(getPluginRoot(), 'sessions', sessionId);
  await mkdir(sessDir, { recursive: true });

  const cwd = opts.cwd || process.cwd();
  const outputFile = opts.outputFile || path.join(sessDir, 'output.jsonl');

  const readOnly = isReadOnlyAgentFile(opts.agentFile);
  const roHome = readOnly ? await prepareReadOnlyHome(getPluginRoot()) : null;

  // Filesystem isolation (read-only backstop): run kimi in a snapshot of the
  // repo — HEAD + uncommitted diff + untracked files — outside the working
  // tree. If no snapshot is possible (non-git dir), run in place: the deny
  // rules remain the (sole) gate and the degradation is reported to callers.
  let snapshot = null;
  if (readOnly) {
    snapshot = await prepareReadOnlySnapshot(cwd, sessDir);
  }
  const effectiveCwd = snapshot?.workspaceDir || cwd;
  const isolation = readOnly
    ? { isolation: snapshot?.workspaceDir ? 'snapshot' : 'in-place', isolationWarning: snapshot?.warning || '' }
    : { isolation: 'none', isolationWarning: '' };

  const args = buildKimiArgs({
    prompt: opts.prompt,
    model: opts.model,
    kimiSessionId: opts.kimiSessionId,
    emptySkillsDir: roHome?.emptySkillsDir,
  });
  const env = buildKimiSpawnEnv({ readOnlyHome: roHome?.homeDir });
  const kimiBin = resolveKimiBin();

  if (opts.background) {
    // Background: detach, write PID, return immediately
    const logFile = path.join(sessDir, 'kimi.log');
    const out = createWriteStream(outputFile);
    const err = createWriteStream(logFile);

    const child = spawn(kimiBin, args, {
      cwd: effectiveCwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    child.unref();

    // Write PID file. The snapshot (if any) is left in the session dir — the
    // broker exits right after a detached spawn, so cleanup belongs to the
    // session lifecycle, not this process.
    const pidFile = path.join(sessDir, 'pid');
    await writeFile(pidFile, String(child.pid));

    return { sessionId, exitCode: null, retries: 0, outputFile, status: 'started', pid: child.pid, ...isolation };
  }

  // Foreground: single run under the watchdogs. kimi-code retries transient
  // provider errors itself (stream-json `meta turn.step.retrying` lines) and
  // has no legacy exit-75 contract, so the broker no longer respawns; a
  // timeout (124) stays terminal.
  const limits = { totalMs: opts.totalTimeoutMs, idleMs: opts.idleTimeoutMs };
  let exitCode;
  try {
    exitCode = await runOnce(kimiBin, args, outputFile, { cwd: effectiveCwd, env }, limits);
  } finally {
    if (!process.env.KIMI_KEEP_SNAPSHOT) await cleanupSnapshot(snapshot?.workspaceDir);
  }

  const timedOut = exitCode === TIMEOUT_EXIT_CODE;
  const finalMessage = await extractFinalMessage(outputFile);
  const kimiSessionId = await extractKimiSessionId(outputFile);
  return { sessionId, exitCode, retries: 0, outputFile, finalMessage, kimiSessionId, timedOut, ...isolation };
}

export const TIMEOUT_EXIT_CODE = 124;

function runOnce(kimiBin, args, outputFile, spawnOpts = {}, limits = {}) {
  const totalMs = limits.totalMs ?? Number(process.env.KIMI_DISPATCH_TIMEOUT_MS || 30 * 60 * 1000);
  const idleMs = limits.idleMs ?? Number(process.env.KIMI_IDLE_TIMEOUT_MS || 5 * 60 * 1000);

  return new Promise((resolve) => {
    const out = createWriteStream(outputFile);
    const child = spawn(kimiBin, args, {
      cwd: spawnOpts.cwd || process.cwd(),
      env: spawnOpts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);

    // Timer handles declared before finish() so a SYNCHRONOUS spawn error
    // (e.g. ENOENT — kimi binary missing) can't hit a temporal-dead-zone
    // ReferenceError when finish() clears them.
    let settled = false;
    let lastOutput = Date.now();
    let hardTimer = null;
    let idleTimer = null;
    let killTimer = null;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (hardTimer) clearTimeout(hardTimer);
      if (idleTimer) clearInterval(idleTimer);
      if (killTimer) clearTimeout(killTimer);
      out.end();
      resolve(code);
    };

    // SIGTERM, then SIGKILL after 2s. killTimer is tracked so finish() clears
    // it — no orphaned timer keeping the event loop alive after resolve.
    const kill = () => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2000);
      killTimer.unref?.();
    };

    hardTimer = setTimeout(() => { kill(); finish(TIMEOUT_EXIT_CODE); }, totalMs);

    // Idle watchdog: kill if no new output for idleMs (a stalled/looping crank).
    child.stdout.on('data', () => { lastOutput = Date.now(); });
    idleTimer = setInterval(() => {
      if (Date.now() - lastOutput > idleMs) { kill(); finish(TIMEOUT_EXIT_CODE); }
    }, Math.min(idleMs, 30000));

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; lastOutput = Date.now(); });

    child.on('close', (code) => {
      // kimi-code `-p`: 0 = success, 1 = any error (API/turn/startup),
      // 129/130/143 = signals. Transient provider retries happen inside the
      // CLI (meta turn.step.retrying), so any non-zero here is terminal.
      finish(code ?? 1);
    });

    child.on('error', () => {
      finish(1);
    });
  });
}

async function extractFinalMessage(outputFile) {
  try {
    const data = await readFile(outputFile, 'utf-8');
    const lines = data.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const obj = safeParse(lines[i]);
      if (obj && obj.role === 'assistant' && obj.content) {
        return obj.content;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * kimi-code prints `{role:'meta', type:'session.resume_hint', session_id}` as
 * the last stream-json line; capture it so a later run can resume the same
 * kimi-code session with `-S` (requires the same cwd and the same
 * KIMI_CODE_HOME the session was created under).
 */
export async function extractKimiSessionId(outputFile) {
  try {
    const data = await readFile(outputFile, 'utf-8');
    const lines = data.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const obj = safeParse(lines[i]);
      if (obj && obj.role === 'meta' && obj.type === 'session.resume_hint' && obj.session_id) {
        return obj.session_id;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

function safeParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/**
 * Watch a session's output.jsonl and emit progress events.
 *
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {boolean} [opts.verbose=false]
 * @param {function} [opts.onEvent] - called with each progress line
 * @returns {Promise<{exitCode: number}>}
 */
export async function watchSession(sessionId, opts = {}) {
  const sessDir = path.join(getPluginRoot(), 'sessions', sessionId);
  const outputFile = path.join(sessDir, 'output.jsonl');
  const metaFile = path.join(sessDir, 'meta.json');

  let lastSize = 0;
  try {
    const s = await stat(outputFile);
    lastSize = s.size;
  } catch {
    lastSize = 0;
  }

  const emit = opts.onEvent || ((line) => console.log(line));

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      let data;
      try {
        const s = await stat(outputFile);
        if (s.size <= lastSize) {
          // Check if session completed
          let meta;
          try {
            meta = JSON.parse(await readFile(metaFile, 'utf-8'));
          } catch {
            meta = null;
          }
          if (meta && ['completed', 'failed', 'cancelled'].includes(meta.status)) {
            clearInterval(interval);
            emit(`[done] ${meta.status}${meta.commit_sha ? ' ' + meta.commit_sha : ''}`);
            resolve({ exitCode: meta.exit_code ?? 0 });
          }
          return;
        }

        data = await readFile(outputFile, 'utf-8');
      } catch {
        return;
      }

      const chunk = data.slice(lastSize);
      lastSize = data.length;

      const lines = chunk.split('\n').filter(Boolean);
      for (const line of lines) {
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
          for (const tc of obj.tool_calls) {
            const name = tc.name || tc.function?.name || '';
            // kimi-code stream-json carries arguments as a JSON string inside
            // `function.arguments`; legacy carried an object. Accept both.
            let args = tc.arguments || tc.args || tc.function?.arguments || {};
            if (typeof args === 'string') args = safeParse(args) || {};
            if (name === 'ReadFile' || name === 'Read') {
              const p = args.path || args.file_path || '';
              emit(`[exploring] reading ${path.basename(p) || p}`);
            } else if (name === 'WriteFile' || name === 'Write' || name === 'Edit' || name === 'StrReplaceFile') {
              const p = args.path || args.file_path || '';
              emit(`[editing] ${path.basename(p) || p}`);
            } else if (name === 'Shell' || name === 'Bash') {
              const cmd = args.command || args.cmd || '';
              if (/eval_\d|eval\d/.test(cmd)) {
                const m = cmd.match(/eval[_-]?\w+/);
                emit(`[verifying] running ${m ? m[0] : 'eval'}`);
              }
            }
          }
        }

        if (opts.verbose && obj.role === 'assistant' && obj.think) {
          const think = obj.think.slice(0, 60).replace(/\n/g, ' ');
          emit(`[thinking] ${think}${obj.think.length > 60 ? '...' : ''}`);
        }
      }
    }, 1000);
  });
}
