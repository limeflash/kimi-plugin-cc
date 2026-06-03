import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTelemetry } from '../plugins/kimi/scripts/lib/telemetry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'real-session.jsonl');

test('parseTelemetry returns non-zero estimated tokens against a real session fixture', async () => {
  const r = await parseTelemetry(FIXTURE);
  assert.ok(r, 'telemetry should not be null');
  assert.ok(r.prompt_tokens > 0, `prompt_tokens should be > 0, got ${r.prompt_tokens}`);
  assert.ok(r.completion_tokens > 0, `completion_tokens should be > 0, got ${r.completion_tokens}`);
  assert.equal(r.estimated, true, 'tokens must be flagged estimated (Kimi emits no usage)');
});

test('parseTelemetry counts real tool-call function names into phases', async () => {
  const r = await parseTelemetry(FIXTURE);
  assert.ok(r.tool_calls.read >= 0);
  assert.ok(r.tool_calls.write >= 0);
  const totalCalls = r.tool_calls.read + r.tool_calls.write + r.tool_calls.verify;
  assert.ok(totalCalls > 0, 'fixture has tool calls; phases should reflect them');
  assert.equal(r.phases.exploration_sec, r.tool_calls.read);
  assert.equal(r.phases.implementation_sec, r.tool_calls.write);
});

test('parseTelemetry does not read the dead obj.usage schema', async () => {
  const r = await parseTelemetry(FIXTURE);
  assert.equal(r.cached_tokens, 0);
  assert.ok(typeof r.estimated_cost_usd === 'number');
});
