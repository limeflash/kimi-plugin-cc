import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { isReadOnlyAgentFile } from '../plugins/kimi/scripts/lib/kimi-home.mjs';

const commandsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'plugins', 'kimi', 'commands',
);

// The agent-file path a slash command passes to `broker.mjs dispatch` IS the
// broker's read-only policy selector (kimi-home.mjs isReadOnlyAgentFile): only
// coder*.yaml gets full write/shell access and commits; everything else runs
// fail-closed read-only. So a read-only command that points at coder.yaml would
// silently gain write access and commit — the /kimi:plan bug. These are the
// intended policies:
const EXPECTED_READONLY = ['kimi:review.md', 'kimi:challenge.md', 'kimi:explore.md', 'kimi:plan.md'];
const EXPECTED_WRITE = ['kimi:crank.md'];

function agentFilesIn(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf-8');
  const matches = [...text.matchAll(/agent-files\/([A-Za-z0-9._-]+\.ya?ml)/g)];
  return matches.map((m) => m[1]);
}

for (const file of EXPECTED_READONLY) {
  test(`${file} dispatches a READ-ONLY agent file (never coder.yaml)`, () => {
    const refs = agentFilesIn(path.join(commandsDir, file));
    assert.ok(refs.length > 0, `${file} must reference an agent file`);
    for (const ref of refs) {
      assert.ok(
        isReadOnlyAgentFile(`/x/agent-files/${ref}`),
        `${file} references ${ref}, which is NOT read-only — a read-only command must not grant write/commit access`,
      );
    }
  });
}

for (const file of EXPECTED_WRITE) {
  test(`${file} dispatches the full-access coder agent file`, () => {
    const refs = agentFilesIn(path.join(commandsDir, file));
    assert.ok(
      refs.some((ref) => !isReadOnlyAgentFile(`/x/agent-files/${ref}`)),
      `${file} must reference a full-access (coder) agent file to land changes`,
    );
  });
}
