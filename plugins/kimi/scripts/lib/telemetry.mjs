import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { warn } from './warn.mjs';

const DEFAULT_COST_PER_1M_INPUT = Number(process.env.KIMI_COST_PER_1M_INPUT || 0.5);
const DEFAULT_COST_PER_1M_OUTPUT = Number(process.env.KIMI_COST_PER_1M_OUTPUT || 2.0);
const DEFAULT_COST_PER_1M_CACHED = Number(process.env.KIMI_COST_PER_1M_CACHED || 0.1);

const READ_TOOLS = new Set(['ReadFile', 'Read', 'Grep', 'Glob', 'LS', 'ListFiles']);
const WRITE_TOOLS = new Set(['WriteFile', 'Edit', 'StrReplaceFile', 'CreateFile', 'ApplyPatch']);

function textLen(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    return content.reduce((n, part) => {
      if (typeof part === 'string') return n + part.length;
      if (part && typeof part.text === 'string') return n + part.text.length;
      if (part && typeof part.think === 'string') return n + part.think.length;
      return n;
    }, 0);
  }
  return 0;
}

/**
 * Parse an output.jsonl file and return a telemetry rollup.
 *
 * Kimi's stream-json output contains NO token-usage field anywhere — each line is
 * only `{role, content, tool_calls|tool_call_id}`. Token counts are therefore
 * ESTIMATED from content length (~4 chars/token) and the result is flagged
 * `estimated: true` so the supervisor is never misled that they are exact.
 * Phases are derived from the ordering of real tool calls (read/grep → exploration,
 * write/edit → implementation, eval/test shell → verification).
 *
 * @param {string} outputFile - path to output.jsonl
 * @returns {Promise<{prompt_tokens:number, completion_tokens:number, cached_tokens:number, estimated:boolean, estimated_cost_usd:number, tool_calls:{read:number,write:number,verify:number}, phases:{exploration_sec:number, implementation_sec:number, verification_sec:number}}>}
 */
export async function parseTelemetry(outputFile) {
  let inputChars = 0;
  let outputChars = 0;
  const order = [];

  let data;
  try {
    data = await readFile(outputFile, 'utf-8');
  } catch (e) {
    await warn('telemetry', e, 'warning');
    return null;
  }

  const lines = data.trim().split('\n').filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    const len = textLen(obj.content);
    if (obj.role === 'assistant') outputChars += len;
    else inputChars += len;

    if (Array.isArray(obj.tool_calls)) {
      for (const tc of obj.tool_calls) {
        const name = tc.function?.name || tc.name || '';
        if (READ_TOOLS.has(name)) {
          order.push('read');
        } else if (WRITE_TOOLS.has(name)) {
          order.push('write');
        } else if (name === 'Shell' || name === 'Bash') {
          const rawArgs = tc.function?.arguments ?? tc.arguments ?? '';
          const cmd = typeof rawArgs === 'string' ? rawArgs : (rawArgs.command || rawArgs.cmd || '');
          order.push(/eval_?\d|eval\b|pytest|\btest\b|--test/.test(cmd) ? 'verify' : 'write');
        }
      }
    }
  }

  const promptTokens = Math.round(inputChars / 4);
  const completionTokens = Math.round(outputChars / 4);
  const cachedTokens = 0;

  const inputCost = (promptTokens / 1_000_000) * DEFAULT_COST_PER_1M_INPUT;
  const outputCost = (completionTokens / 1_000_000) * DEFAULT_COST_PER_1M_OUTPUT;
  const cachedCost = (cachedTokens / 1_000_000) * DEFAULT_COST_PER_1M_CACHED;
  const estimatedCost = inputCost + outputCost + cachedCost;

  const counts = { read: 0, write: 0, verify: 0 };
  for (const p of order) counts[p]++;
  const total = order.length || 1;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cached_tokens: cachedTokens,
    estimated: true,
    estimated_cost_usd: Math.round(estimatedCost * 10000) / 10000,
    tool_calls: counts,
    phases: phaseSeconds(counts, total),
  };
}

/**
 * Apportion phase wall-clock from tool-call counts. Kimi emits no per-event
 * timestamps, so phases are weighted by how many read/write/verify tool calls
 * fired. The absolute duration is unknown at parse time; attachTelemetry scales
 * this against meta.started_at..finished_at when both are present.
 */
function phaseSeconds(counts, total) {
  return {
    exploration_sec: counts.read,
    implementation_sec: counts.write,
    verification_sec: counts.verify,
  };
}

/**
 * Attach telemetry to a session's meta.json.
 *
 * @param {string} sessionId
 * @param {string} sessionsDir
 */
export async function attachTelemetry(sessionId, sessionsDir) {
  const outputFile = path.join(sessionsDir, sessionId, 'output.jsonl');
  const metaFile = path.join(sessionsDir, sessionId, 'meta.json');

  const telemetry = await parseTelemetry(outputFile);
  if (!telemetry) return;

  const { readFile, writeFile } = await import('node:fs/promises');
  let meta;
  try {
    meta = JSON.parse(await readFile(metaFile, 'utf-8'));
  } catch (e) {
    await warn('telemetry', e, 'warning');
    return;
  }

  // Scale the count-weighted phases into real wall-clock seconds using the
  // session's actual elapsed time (started_at..finished_at), apportioned by
  // tool-call mix. Falls back to the raw counts when timestamps are absent.
  if (meta.started_at && meta.finished_at) {
    const elapsed = Math.max(0, (new Date(meta.finished_at) - new Date(meta.started_at)) / 1000);
    const p = telemetry.phases;
    const sum = p.exploration_sec + p.implementation_sec + p.verification_sec;
    if (sum > 0 && elapsed > 0) {
      telemetry.phases = {
        exploration_sec: Math.round((p.exploration_sec / sum) * elapsed),
        implementation_sec: Math.round((p.implementation_sec / sum) * elapsed),
        verification_sec: Math.round((p.verification_sec / sum) * elapsed),
      };
      telemetry.elapsed_sec = Math.round(elapsed);
    }
  }

  meta.telemetry = telemetry;
  await writeFile(metaFile, JSON.stringify(meta, null, 2));
}
