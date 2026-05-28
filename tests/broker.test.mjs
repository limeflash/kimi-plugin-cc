import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brokerPath = path.join(__dirname, '..', 'plugins', 'kimi', 'scripts', 'broker.mjs');

test('broker usage message lists all subcommands', async () => {
  const result = await new Promise((resolve) => {
    execFile('node', [brokerPath], (err, stdout, stderr) => {
      resolve({ stdout, stderr, code: err ? err.code : 0 });
    });
  });

  const text = result.stdout || result.stderr;
  assert.ok(text.includes('dispatch'), 'usage mentions dispatch');
  assert.ok(text.includes('status'), 'usage mentions status');
  assert.ok(text.includes('result'), 'usage mentions result');
  assert.ok(text.includes('cancel'), 'usage mentions cancel');
  assert.ok(text.includes('diff-capture'), 'usage mentions diff-capture');
  assert.ok(text.includes('watch'), 'usage mentions watch');
  assert.ok(text.includes('report'), 'usage mentions report');
  assert.ok(text.includes('telemetry'), 'usage mentions telemetry');
  assert.ok(text.includes('checkpoint'), 'usage mentions checkpoint');
  assert.ok(text.includes('monitor'), 'usage mentions monitor');
  assert.ok(text.includes('warnings'), 'usage mentions warnings');
  assert.ok(text.includes('batch'), 'usage mentions batch');
  assert.ok(text.includes('next'), 'usage mentions next');
});

test('broker dispatch --help-ish exits with usage', async () => {
  const result = await new Promise((resolve) => {
    execFile('node', [brokerPath, 'unknown-cmd'], (err, stdout, stderr) => {
      resolve({ stdout, stderr, exited: !!err });
    });
  });
  assert.ok(result.exited, 'unknown command exits');
});
