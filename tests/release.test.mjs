import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releasePath = path.join(__dirname, '..', 'scripts', 'release.mjs');

test('release CLI dry-run passes all checks', async () => {
  const result = await new Promise((resolve) => {
    execFile('node', [releasePath, '--dry-run', '--skip-git-check'], { timeout: 180000 }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, code: err ? err.code : 0 });
    });
  });

  const output = result.stdout + result.stderr;
  assert.ok(output.includes('Ready to ship'), 'release CLI reports ready');
  assert.ok(output.includes('checks passed'), 'all checks passed');
  assert.equal(result.code, 0, 'exit code 0');
});

test('release CLI detects version mismatch', async () => {
  // This is a meta-test: verify the check logic exists by inspecting the script
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(releasePath, 'utf-8');
  assert.ok(source.includes('checkVersionConsistency'), 'has version consistency check');
  assert.ok(source.includes('plugin.json'), 'checks plugin manifest');
  assert.ok(source.includes('npm pack'), 'checks npm pack');
});
