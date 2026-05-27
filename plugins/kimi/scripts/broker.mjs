#!/usr/bin/env node
import { invokeKimi } from './lib/kimi.mjs';
import { captureDiff, getBranchDiff, getWorkingDiff } from './lib/git.mjs';
import { initSessionDir, writeMeta, readMeta, listSessions, isRunning, getLatestSessionForRepo } from './lib/state.mjs';
import { startBackground, cancelSession } from './lib/job-control.mjs';
import { findRepoRoot, readRepoSession, writeRepoSession } from './lib/workspace.mjs';
import { renderReview, renderExplore } from './lib/render.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`Usage: broker.mjs <command> [options]
Commands:
  dispatch --prompt <text> --agent-file <path> [--background] [--model] [--session-id] [--mode]
  status [--session-id <id>]
  result [--session-id <id>] [--raw]
  cancel [--session-id <id>]
  diff-capture --session-id <id> --phase <pre|post>
  branch-diff --base <ref>
  working-diff
  latest-session
`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (next !== undefined) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, args };
}

async function cmdDispatch(opts) {
  await initSessionDir();
  const repoPath = await findRepoRoot();

  const prompt = opts.prompt;
  const agentFile = path.resolve(opts.agent_file);
  const background = opts.background === true || opts.background === 'true';
  const model = opts.model || '';
  const sessionId = opts.session_id || crypto.randomUUID();
  const mode = opts.mode || 'crank';

  if (background) {
    const result = await startBackground({
      sessionId,
      agentFile,
      prompt,
      model,
      mode,
    });
    console.log(JSON.stringify(result));
    return;
  }

  // Foreground
  await writeMeta(sessionId, {
    session_id: sessionId,
    agent_file: agentFile,
    prompt,
    model,
    started_at: new Date().toISOString(),
    status: 'running',
    repo_path: repoPath,
    mode,
  });

  const result = await invokeKimi({
    prompt,
    agentFile,
    model,
    sessionId,
    background: false,
  });

  await writeMeta(sessionId, {
    status: result.exitCode === 0 ? 'completed' : 'failed',
    exit_code: result.exitCode,
    finished_at: new Date().toISOString(),
  });

  await writeRepoSession(repoPath, sessionId);

  console.log(JSON.stringify(result));
}

async function cmdStatus(opts) {
  await initSessionDir();
  const sessionId = opts.session_id;
  if (sessionId) {
    try {
      const meta = await readMeta(sessionId);
      meta.running = await isRunning(sessionId);
      console.log(JSON.stringify(meta));
    } catch {
      console.log(JSON.stringify({ error: 'Session not found' }));
      process.exit(1);
    }
  } else {
    const sessions = await listSessions();
    console.log(JSON.stringify({ sessions }));
  }
}

async function cmdResult(opts) {
  const sessionId = opts.session_id;
  const raw = opts.raw === true || opts.raw === 'true';

  if (!sessionId) {
    const repoPath = await findRepoRoot();
    const latest = await readRepoSession(repoPath) || (await getLatestSessionForRepo(repoPath))?.session_id;
    if (!latest) {
      console.log(JSON.stringify({ error: 'No session found' }));
      process.exit(1);
    }
    return cmdResult({ ...opts, session_id: latest });
  }

  const sessDir = path.join(process.env.HOME, '.kimi-plugin-cc', 'sessions', sessionId);
  const outputFile = path.join(sessDir, 'output.jsonl');

  if (raw) {
    try {
      const data = await readFile(outputFile, 'utf-8');
      console.log(data);
    } catch {
      console.log(JSON.stringify({ error: 'No output captured yet' }));
      process.exit(1);
    }
    return;
  }

  // Extract final assistant message
  try {
    const data = await readFile(outputFile, 'utf-8');
    const lines = data.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const obj = JSON.parse(lines[i]);
      if (obj.role === 'assistant' && obj.content) {
        console.log(obj.content);
        return;
      }
    }
    console.log('(no assistant message found)');
  } catch {
    console.log(JSON.stringify({ error: 'No output captured yet' }));
    process.exit(1);
  }
}

async function cmdCancel(opts) {
  const sessionId = opts.session_id;
  if (!sessionId) {
    const repoPath = await findRepoRoot();
    const latest = await readRepoSession(repoPath) || (await getLatestSessionForRepo(repoPath))?.session_id;
    if (!latest) {
      console.log(JSON.stringify({ error: 'No session found' }));
      process.exit(1);
    }
    return cmdCancel({ ...opts, session_id: latest });
  }

  const result = await cancelSession(sessionId);
  console.log(JSON.stringify(result));
}

async function cmdDiffCapture(opts) {
  const sessionId = opts.session_id;
  const phase = opts.phase;
  const repoPath = await findRepoRoot();
  await captureDiff(sessionId, phase, repoPath);
}

async function cmdBranchDiff(opts) {
  const base = opts.base || 'main';
  const diff = await getBranchDiff(base);
  console.log(diff);
}

async function cmdWorkingDiff() {
  const diff = await getWorkingDiff();
  console.log(diff);
}

async function cmdLatestSession() {
  const repoPath = await findRepoRoot();
  const id = await readRepoSession(repoPath) || (await getLatestSessionForRepo(repoPath))?.session_id;
  console.log(JSON.stringify({ session_id: id || null }));
}

async function main() {
  const { positional, args } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];

  switch (cmd) {
    case 'dispatch': await cmdDispatch(args); break;
    case 'status': await cmdStatus(args); break;
    case 'result': await cmdResult(args); break;
    case 'cancel': await cmdCancel(args); break;
    case 'diff-capture': await cmdDiffCapture(args); break;
    case 'branch-diff': await cmdBranchDiff(args); break;
    case 'working-diff': await cmdWorkingDiff(); break;
    case 'latest-session': await cmdLatestSession(); break;
    default: usage();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
