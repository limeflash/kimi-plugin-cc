import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-plugin-test-'));
}

export function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
