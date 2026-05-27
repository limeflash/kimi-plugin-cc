import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Wrap the local `kimi` CLI with retry logic and JSONL capture.
 */

const KIMI_PLUGIN_ROOT = path.join(process.env.HOME, '.kimi-plugin-cc');

/**
 * Invoke kimi --print with structured output capture.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.agentFile - absolute path to agent YAML
 * @param {string} [opts.model]
 * @param {string} [opts.sessionId]
 * @param {boolean} [opts.background=false]
 * @param {string} [opts.outputFile] - where to write JSONL (defaults to session dir)
 * @returns {Promise<{sessionId: string, exitCode: number, retries: number, outputFile: string, finalMessage?: string}>}
 */
export async function invokeKimi(opts) {
  const sessionId = opts.sessionId || crypto.randomUUID();
  const sessDir = path.join(KIMI_PLUGIN_ROOT, 'sessions', sessionId);
  await mkdir(sessDir, { recursive: true });

  const outputFile = opts.outputFile || path.join(sessDir, 'output.jsonl');

  const args = [
    '--print',
    '--yolo',
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
    exitCode = await runOnce(args, outputFile);
    if (exitCode !== 75 || retries >= maxRetries) break;
    retries++;
    await sleep(retries * 5000);
  }

  const finalMessage = await extractFinalMessage(outputFile);
  return { sessionId, exitCode, retries, outputFile, finalMessage };
}

function runOnce(args, outputFile) {
  return new Promise((resolve) => {
    const out = createWriteStream(outputFile);
    const child = spawn('kimi', args, {
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
