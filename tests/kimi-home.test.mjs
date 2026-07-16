import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanupTempDir } from './helpers.mjs';
import {
  READ_ONLY_ALLOWED_TOOLS,
  readOnlyDenyPattern,
  buildReadOnlyDenyBlock,
  isReadOnlyAgentFile,
  prepareReadOnlyHome,
  buildKimiArgs,
  buildKimiSpawnEnv,
  resolveKimiBin,
} from '../plugins/kimi/scripts/lib/kimi-home.mjs';

// ---------------------------------------------------------------------------
// Read-only allow-set (successor of the explore.yaml fail-closed lint)
// ---------------------------------------------------------------------------

test('read-only allow-set grants ONLY kimi-code read tools', () => {
  // Exact-set assertion: adding a write/exec/egress tool here must fail review.
  assert.deepEqual(
    [...READ_ONLY_ALLOWED_TOOLS].sort(),
    ['Glob', 'Grep', 'Read', 'ReadMediaFile'].sort(),
  );
  const forbidden = ['Write', 'Edit', 'Bash', 'Shell', 'Agent', 'AgentSwarm', 'Skill',
    'WebSearch', 'FetchURL', 'TaskStop', 'CronCreate', 'CronDelete'];
  for (const tool of forbidden) {
    assert.ok(!READ_ONLY_ALLOWED_TOOLS.includes(tool), `${tool} must not be in the allow-set`);
  }
});

test('deny pattern is brace-negation (extglob parens would be silently fail-open)', () => {
  const pattern = readOnlyDenyPattern();
  // The kimi-code permission DSL splits on the first "(": an extglob !(a|b)
  // parses as tool "!" + arg pattern and never matches anything. The pattern
  // must therefore be the paren-free brace negation !{a,b}.
  assert.ok(!pattern.includes('('), `pattern must not contain parens, got: ${pattern}`);
  assert.ok(!pattern.includes(')'), `pattern must not contain parens, got: ${pattern}`);
  assert.ok(pattern.startsWith('!{') && pattern.endsWith('}'), `must be !{...}, got: ${pattern}`);
  for (const tool of READ_ONLY_ALLOWED_TOOLS) {
    assert.ok(pattern.includes(tool), `${tool} missing from deny-exception set`);
  }
});

test('deny block is a single fail-closed deny rule', () => {
  const block = buildReadOnlyDenyBlock();
  assert.match(block, /\[\[permission\.rules\]\]/);
  assert.match(block, /decision = "deny"/);
  assert.ok(block.includes(`pattern = "${readOnlyDenyPattern()}"`));
  // No allow/ask rules — deny-only, so nothing here can widen access.
  assert.doesNotMatch(block, /decision = "allow"/);
  assert.doesNotMatch(block, /decision = "ask"/);
});

// ---------------------------------------------------------------------------
// Policy selector — fail-closed on unknown agent files
// ---------------------------------------------------------------------------

test('only coder agent files get full access; everything else is read-only', () => {
  assert.equal(isReadOnlyAgentFile('/x/agent-files/coder.yaml'), false);
  assert.equal(isReadOnlyAgentFile('/x/agent-files/coder-sub.yaml'), false);
  assert.equal(isReadOnlyAgentFile('/x/agent-files/explore.yaml'), true);
  assert.equal(isReadOnlyAgentFile('/x/agent-files/explore-sub.yaml'), true);
  assert.equal(isReadOnlyAgentFile('/x/agent-files/plan-sub.yaml'), true);
  // Fail-closed: unknown, typoed, or missing agent files run read-only.
  assert.equal(isReadOnlyAgentFile('/x/agent-files/coder2.yaml'), true);
  assert.equal(isReadOnlyAgentFile('/fake/agent.yaml'), true);
  assert.equal(isReadOnlyAgentFile(''), true);
  assert.equal(isReadOnlyAgentFile(undefined), true);
});

// ---------------------------------------------------------------------------
// Ephemeral home
// ---------------------------------------------------------------------------

test('prepareReadOnlyHome writes user config + deny block and links credentials', async () => {
  const tmpPlugin = makeTempDir();
  const tmpUserHome = makeTempDir();
  const prevUserHome = process.env.KIMI_CODE_USER_HOME;
  process.env.KIMI_CODE_USER_HOME = tmpUserHome;

  try {
    fs.writeFileSync(path.join(tmpUserHome, 'config.toml'),
      'default_model = "kimi-code/k3"\n\n[providers.p]\ntype = "kimi"\n');
    fs.mkdirSync(path.join(tmpUserHome, 'credentials'));
    fs.writeFileSync(path.join(tmpUserHome, 'credentials', 'kimi-code.json'), '{}');

    const { homeDir, emptySkillsDir } = await prepareReadOnlyHome(tmpPlugin);

    const config = fs.readFileSync(path.join(homeDir, 'config.toml'), 'utf-8');
    assert.ok(config.includes('default_model = "kimi-code/k3"'), 'user config must be carried over');
    assert.ok(config.includes(`pattern = "${readOnlyDenyPattern()}"`), 'deny rule must be appended');
    // Deny block must come AFTER the user config so it can never be swallowed
    // by a user table, and must appear exactly once.
    assert.equal(config.indexOf('[[permission.rules]]'), config.lastIndexOf('[[permission.rules]]'));

    const credLink = path.join(homeDir, 'credentials');
    assert.ok(fs.lstatSync(credLink).isSymbolicLink(), 'credentials must be a symlink');
    assert.equal(fs.realpathSync(credLink), fs.realpathSync(path.join(tmpUserHome, 'credentials')));

    assert.ok(fs.statSync(emptySkillsDir).isDirectory());
    assert.equal(fs.readdirSync(emptySkillsDir).length, 0, 'skills override dir must be empty');
  } finally {
    if (prevUserHome === undefined) delete process.env.KIMI_CODE_USER_HOME;
    else process.env.KIMI_CODE_USER_HOME = prevUserHome;
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(tmpUserHome);
  }
});

test('prepareReadOnlyHome does not accumulate deny blocks across runs', async () => {
  const tmpPlugin = makeTempDir();
  const tmpUserHome = makeTempDir();
  const prevUserHome = process.env.KIMI_CODE_USER_HOME;
  process.env.KIMI_CODE_USER_HOME = tmpUserHome;

  try {
    fs.writeFileSync(path.join(tmpUserHome, 'config.toml'), 'default_model = "m"\n');
    const first = await prepareReadOnlyHome(tmpPlugin);
    const second = await prepareReadOnlyHome(tmpPlugin);
    assert.equal(first.homeDir, second.homeDir);
    const config = fs.readFileSync(path.join(second.homeDir, 'config.toml'), 'utf-8');
    const matches = config.match(/\[\[permission\.rules\]\]/g) || [];
    assert.equal(matches.length, 1, 'regenerating the home must not stack deny rules');
  } finally {
    if (prevUserHome === undefined) delete process.env.KIMI_CODE_USER_HOME;
    else process.env.KIMI_CODE_USER_HOME = prevUserHome;
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(tmpUserHome);
  }
});

test('prepareReadOnlyHome still enforces deny rules when user config is missing', async () => {
  const tmpPlugin = makeTempDir();
  const tmpUserHome = makeTempDir(); // empty: no config.toml, no credentials
  const prevUserHome = process.env.KIMI_CODE_USER_HOME;
  process.env.KIMI_CODE_USER_HOME = tmpUserHome;

  try {
    const { homeDir } = await prepareReadOnlyHome(tmpPlugin);
    const config = fs.readFileSync(path.join(homeDir, 'config.toml'), 'utf-8');
    assert.ok(config.includes('decision = "deny"'));
    assert.ok(!fs.existsSync(path.join(homeDir, 'credentials')), 'no credentials source → no link');
  } finally {
    if (prevUserHome === undefined) delete process.env.KIMI_CODE_USER_HOME;
    else process.env.KIMI_CODE_USER_HOME = prevUserHome;
    cleanupTempDir(tmpPlugin);
    cleanupTempDir(tmpUserHome);
  }
});

// ---------------------------------------------------------------------------
// argv / env builders
// ---------------------------------------------------------------------------

test('buildKimiArgs emits kimi-code prompt-mode argv without legacy flags', () => {
  const args = buildKimiArgs({ prompt: 'hello', model: 'kimi-code/k3', emptySkillsDir: '/e' });
  assert.deepEqual(args, [
    '--output-format', 'stream-json',
    '-m', 'kimi-code/k3',
    '--skills-dir', '/e',
    '-p', 'hello',
  ]);
  for (const legacy of ['--print', '--yolo', '--auto', '--plan', '--work-dir', '--agent-file']) {
    assert.ok(!args.includes(legacy), `${legacy} must never be passed (conflicts with -p or removed)`);
  }
});

test('buildKimiArgs supports resuming a kimi-code session with -S', () => {
  const args = buildKimiArgs({ prompt: 'go on', kimiSessionId: 'abc123' });
  const sIdx = args.indexOf('-S');
  assert.ok(sIdx >= 0);
  assert.equal(args[sIdx + 1], 'abc123');
});

test('buildKimiSpawnEnv points read-only runs at the ephemeral home', () => {
  const env = buildKimiSpawnEnv({ readOnlyHome: '/ro/home' });
  assert.equal(env.KIMI_CODE_HOME, '/ro/home');
  assert.equal(env.KIMI_DISABLE_TELEMETRY, '1');
  assert.equal(env.KIMI_CODE_NO_AUTO_UPDATE, '1');

  const full = buildKimiSpawnEnv({});
  assert.equal(full.KIMI_CODE_NO_AUTO_UPDATE, '1');
  assert.ok(!('KIMI_CODE_HOME' in full) || full.KIMI_CODE_HOME === process.env.KIMI_CODE_HOME,
    'full-access runs must keep the user home');
});

test('resolveKimiBin honors KIMI_BIN override', () => {
  const prev = process.env.KIMI_BIN;
  process.env.KIMI_BIN = '/custom/kimi';
  try {
    assert.equal(resolveKimiBin(), '/custom/kimi');
  } finally {
    if (prev === undefined) delete process.env.KIMI_BIN;
    else process.env.KIMI_BIN = prev;
  }
});
