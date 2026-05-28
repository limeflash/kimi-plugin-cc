import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { warn } from './warn.mjs';

const DEFAULT_COST_PER_1M_INPUT = Number(process.env.KIMI_COST_PER_1M_INPUT || 0.5);
const DEFAULT_COST_PER_1M_OUTPUT = Number(process.env.KIMI_COST_PER_1M_OUTPUT || 2.0);
const DEFAULT_COST_PER_1M_CACHED = Number(process.env.KIMI_COST_PER_1M_CACHED || 0.1);

/**
 * Parse an output.jsonl file and return telemetry rollup.
 *
 * @param {string} outputFile - path to output.jsonl
 * @returns {Promise<{prompt_tokens:number, completion_tokens:number, cached_tokens:number, estimated_cost_usd:number, phases:{exploration_sec:number, implementation_sec:number, verification_sec:number}}>}
 */
export async function parseTelemetry(outputFile) {
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;

  const toolCallTimes = {
    read: [],
    write: [],
    shell_eval: [],
  };

  let data;
  try {
    data = await readFile(outputFile, 'utf-8');
  } catch (e) {
    await warn('telemetry', e, 'warning');
    return null;
  }

  const lines = data.trim().split('\n').filter(Boolean);
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Token usage events
    if (obj.usage) {
      promptTokens += obj.usage.prompt_tokens || 0;
      completionTokens += obj.usage.completion_tokens || 0;
      cachedTokens += obj.usage.cached_tokens || obj.usage.prompt_tokens_details?.cached_tokens || 0;
    }

    // Tool calls for phase heuristics
    if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
      for (const tc of obj.tool_calls) {
        const name = tc.name || tc.function?.name || '';
        const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();
        if (name === 'ReadFile' || name === 'Read') {
          toolCallTimes.read.push(ts);
        } else if (name === 'WriteFile' || name === 'Edit' || name === 'StrReplaceFile') {
          toolCallTimes.write.push(ts);
        } else if (name === 'Shell' || name === 'Bash') {
          const args = tc.arguments || tc.args || {};
          const cmd = args.command || args.cmd || '';
          if (/eval_\d|eval\d|test/.test(cmd)) {
            toolCallTimes.shell_eval.push(ts);
          }
        }
      }
    }
  }

  const inputCost = (promptTokens / 1_000_000) * DEFAULT_COST_PER_1M_INPUT;
  const outputCost = (completionTokens / 1_000_000) * DEFAULT_COST_PER_1M_OUTPUT;
  const cachedCost = (cachedTokens / 1_000_000) * DEFAULT_COST_PER_1M_CACHED;
  const estimatedCost = inputCost + outputCost + cachedCost;

  const phases = {
    exploration_sec: spanSeconds(toolCallTimes.read),
    implementation_sec: spanSeconds(toolCallTimes.write),
    verification_sec: spanSeconds(toolCallTimes.shell_eval),
  };

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cached_tokens: cachedTokens,
    estimated_cost_usd: Math.round(estimatedCost * 10000) / 10000,
    phases,
  };
}

function spanSeconds(arr) {
  if (arr.length < 2) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return Math.round((sorted[sorted.length - 1] - sorted[0]) / 1000);
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
  meta.telemetry = telemetry;
  await writeFile(metaFile, JSON.stringify(meta, null, 2));
}
