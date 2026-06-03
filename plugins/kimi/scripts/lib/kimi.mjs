import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Wrap the local `kimi` CLI with retry logic and JSONL capture.
 */

function getPluginRoot() {
  return process.env.KIMI_PLUGIN_DATA
    ? path.join(process.env.KIMI_PLUGIN_DATA)
    : path.join(process.env.HOME, '.kimi-plugin-cc');
}

/**
 * Invoke kimi --print with structured output capture.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.agentFile - absolute path to agent YAML
 * @param {string} [opts.model]
 * @param {string} [opts.sessionId]
 * @param {boolean} [opts.background=false]
 * @param {string} [opts.cwd] - working directory for the kimi process (e.g. an isolated worktree). Defaults to process.cwd().
 * @param {string} [opts.outputFile] - where to write JSONL (defaults to session dir)
 * @returns {Promise<{sessionId: string, exitCode: number, retries: number, outputFile: string, finalMessage?: string}>}
 */
export async function invokeKimi(opts) {
  const sessionId = opts.sessionId || crypto.randomUUID();
  const sessDir = path.join(getPluginRoot(), 'sessions', sessionId);
  await mkdir(sessDir, { recursive: true });

  const cwd = opts.cwd || process.cwd();
  const outputFile = opts.outputFile || path.join(sessDir, 'output.jsonl');

  const args = [
    '--print',
    '--yolo',
    '--work-dir', cwd,
    '--output-format', 'stream-json',
    '--agent-file', opts.agentFile,
  ];
  if (opts.model) {
    args.push('--model', opts.model);
  }
  args.push('-p', opts.prompt);

  if (opts.background) {
    // Background: detach, write PID, return immediately
    const logFile = path.join(sessDir, 'kimi.log');
    const out = createWriteStream(outputFile);
    const err = createWriteStream(logFile);

    const child = spawn('kimi', args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    child.unref();

    // Write PID file
    const pidFile = path.join(sessDir, 'pid');
    await writeFile(pidFile, String(child.pid));

    return { sessionId, exitCode: null, retries: 0, outputFile, status: 'started', pid: child.pid };
  }

  // Foreground: capture with retry on exit 75
  let exitCode = 0;
  let retries = 0;
  const maxRetries = 3;

  while (true) {
    exitCode = await runOnce(args, outputFile, cwd);
    if (exitCode !== 75 || retries >= maxRetries) break;
    retries++;
    await sleep(retries * 5000);
  }

  const finalMessage = await extractFinalMessage(outputFile);
  return { sessionId, exitCode, retries, outputFile, finalMessage };
}

function runOnce(args, outputFile, cwd) {
  return new Promise((resolve) => {
    const out = createWriteStream(outputFile);
    const child = spawn('kimi', args, {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code) => {
      out.end();
      // kimi --print uses exit code 75 for transient errors
      resolve(code ?? 1);
    });

    child.on('error', () => {
      out.end();
      resolve(1);
    });
  });
}

async function extractFinalMessage(outputFile) {
  try {
    const { readFile } = await import('node:fs/promises');
    const data = await readFile(outputFile, 'utf-8');
    const lines = data.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const obj = JSON.parse(lines[i]);
      if (obj.role === 'assistant' && obj.content) {
        return obj.content;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
            const args = tc.arguments || tc.args || {};
            if (name === 'ReadFile' || name === 'Read') {
              const p = args.path || '';
              emit(`[exploring] reading ${path.basename(p) || p}`);
            } else if (name === 'WriteFile' || name === 'Edit' || name === 'StrReplaceFile') {
              const p = args.path || '';
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
