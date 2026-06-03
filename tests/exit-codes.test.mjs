import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

test('broker usage() documents the exit-code table (0,2,3,4,5,6)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'plugins/kimi/scripts/broker.mjs'), 'utf-8');
  assert.match(src, /Exit codes/i);
  for (const code of ['2', '3', '4', '5', '6']) {
    assert.match(src, new RegExp(`\\n\\s*${code}\\s+`), `exit code ${code} must be documented`);
  }
  assert.match(src, /origin-diverged/);
  assert.match(src, /buggy-evals/);
  assert.match(src, /review-pause/);
  assert.match(src, /checkpoint-conflict/);
});

test('commands.mjs no longer flattens review-pause early-returns to exitCode 0', () => {
  const src = fs.readFileSync(path.join(ROOT, 'plugins/kimi/scripts/lib/commands.mjs'), 'utf-8');
  assert.match(src, /reason: 'api-validation'[^}]*exitCode: 4/);
  assert.match(src, /reason: 'diff-review'[^}]*exitCode: 4/);
  assert.doesNotMatch(src, /api_validation: validation\.concerns, committed: false, exitCode: 0/);
  assert.doesNotMatch(src, /diff_review: review\.verdict, committed: false, exitCode: 0/);
});
