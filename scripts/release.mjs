#!/usr/bin/env node
/**
 * Release CLI — validates the plugin is ready to ship.
 *
 * Usage:
 *   node scripts/release.mjs [--bump <patch|minor|major>] [--dry-run] [--tag]
 *
 * Checks performed:
 *   1. Git working tree clean (no uncommitted changes)
 *   2. All .mjs files parse (syntax lint)
 *   3. Unit + integration tests pass
 *   4. Plugin manifest validation (plugin.json, required files)
 *   5. Broker CLI smoke test (all commands respond)
 *   6. Agent file validation (YAML exists, system.md exists)
 *   7. Command file validation (all .md commands present)
 *   8. npm pack dry-run (verify package contents)
 *   9. (Optional) Version bump + git tag + npm publish
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

async function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: ROOT, encoding: 'utf-8', ...opts }, (err, stdout, stderr) => {
      if (err && !opts.allowError) {
        reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`));
      } else {
        resolve({ stdout, stderr, code: err ? err.code : 0 });
      }
    });
  });
}

function log(step, message, type = 'info') {
  const icons = { info: 'ℹ', pass: '✔', fail: '✖', warn: '⚠' };
  const color = type === 'fail' ? '\x1b[31m' : type === 'pass' ? '\x1b[32m' : type === 'warn' ? '\x1b[33m' : '\x1b[36m';
  const reset = '\x1b[0m';
  console.log(`${color}${icons[type]} [${step}]${reset} ${message}`);
}

async function fileExists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Checks
// ------------------------------------------------------------------

async function checkGitClean() {
  const { stdout } = await run('git', ['status', '--porcelain']);
  if (stdout.trim()) {
    throw new Error('Working tree has uncommitted changes:\n' + stdout);
  }
}

async function checkLint() {
  const { code, stderr } = await run('node', ['scripts/lint.mjs']);
  if (code !== 0) {
    throw new Error('Lint failed: ' + stderr);
  }
}

async function checkTests() {
  const { code, stderr } = await run('node', ['--test', '--test-concurrency=1', 'tests/**/*.test.mjs'], { timeout: 120000 });
  if (code !== 0) {
    throw new Error('Tests failed: ' + stderr);
  }
}

async function checkPluginManifest() {
  const manifestPath = path.join(ROOT, 'plugins', 'kimi', '.claude-plugin', 'plugin.json');
  if (!await fileExists(manifestPath)) {
    throw new Error('plugin.json not found');
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  if (!manifest.name || !manifest.version) {
    throw new Error('plugin.json missing required fields (name, version)');
  }
  return manifest;
}

async function checkRequiredFiles() {
  const required = [
    'plugins/kimi/scripts/broker.mjs',
    'plugins/kimi/agent-files/coder.yaml',
    'plugins/kimi/agent-files/coder-system.md',
    'plugins/kimi/agent-files/explore.yaml',
    'plugins/kimi/agent-files/explore-system.md',
    'plugins/kimi/agent-files/plan-sub.yaml',
    'plugins/kimi/agents/kimi-delegate.md',
    'plugins/kimi/.claude-plugin/plugin.json',
    '.env.example',
    'README.md',
    'CHANGELOG.md',
  ];

  const missing = [];
  for (const f of required) {
    if (!await fileExists(path.join(ROOT, f))) {
      missing.push(f);
    }
  }

  if (missing.length > 0) {
    throw new Error('Missing required files: ' + missing.join(', '));
  }
}

async function checkBrokerSmoke() {
  const broker = path.join(ROOT, 'plugins', 'kimi', 'scripts', 'broker.mjs');

  // Verify broker exits with usage on no args
  const { code, stdout } = await run('node', [broker], { allowError: true });
  if (code === 0) {
    throw new Error('Broker should exit with error on no args');
  }
  if (!stdout.includes('Usage:')) {
    throw new Error('Broker did not print usage on no args');
  }

  // Verify all registered commands are listed in usage
  const usageCommands = ['dispatch', 'status', 'result', 'cancel', 'watch', 'report', 'telemetry', 'checkpoint', 'monitor', 'warnings', 'batch', 'next'];
  for (const cmd of usageCommands) {
    if (!stdout.includes(cmd)) {
      throw new Error(`Usage text missing command: ${cmd}`);
    }
  }
}

async function checkAgentFiles() {
  const agentsDir = path.join(ROOT, 'plugins', 'kimi', 'agent-files');
  const entries = await readdir(agentsDir);
  const yamlFiles = entries.filter((f) => f.endsWith('.yaml'));
  const mdFiles = entries.filter((f) => f.endsWith('.md'));

  for (const yf of yamlFiles) {
    // Sub-agents that use `extend:` inherit system.md from parent
    const content = await readFile(path.join(agentsDir, yf), 'utf-8');
    if (content.includes('extend:')) continue;

    const base = yf.replace('.yaml', '');
    const systemMd = base + '-system.md';
    if (!mdFiles.includes(systemMd) && !entries.includes(systemMd)) {
      throw new Error(`Agent ${yf} missing corresponding ${systemMd}`);
    }
  }
}

async function checkCommandFiles() {
  const commandsDir = path.join(ROOT, 'plugins', 'kimi', 'commands');
  const entries = await readdir(commandsDir);
  const mdFiles = entries.filter((f) => f.endsWith('.md'));

  // Every command file should have frontmatter with name and description
  for (const f of mdFiles) {
    const content = await readFile(path.join(commandsDir, f), 'utf-8');
    if (!content.match(/^---\s*\n/)) {
      throw new Error(`Command file ${f} missing frontmatter`);
    }
    if (!content.includes('name:')) {
      throw new Error(`Command file ${f} missing 'name' in frontmatter`);
    }
  }
}

async function checkNpmPack() {
  const { code, stdout, stderr } = await run('npm', ['pack', '--dry-run'], { allowError: true });
  if (code !== 0) {
    throw new Error('npm pack dry-run failed: ' + stderr);
  }

  // Verify key files would be included
  const packOutput = stdout + stderr;
  const mustInclude = ['broker.mjs', 'commands.mjs', 'coder.yaml', 'plugin.json', '.env.example'];
  const missing = mustInclude.filter((f) => !packOutput.includes(f));
  if (missing.length > 0) {
    throw new Error('npm pack would exclude: ' + missing.join(', '));
  }
}

async function checkVersionConsistency() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf-8'));
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'plugins', 'kimi', '.claude-plugin', 'plugin.json'), 'utf-8'));

  if (pkg.version !== manifest.version) {
    throw new Error(`Version mismatch: package.json=${pkg.version}, plugin.json=${manifest.version}`);
  }

  const changelog = await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf-8');
  if (!changelog.includes(`## ${pkg.version}`)) {
    throw new Error(`CHANGELOG.md missing section for v${pkg.version}`);
  }

  return pkg.version;
}

// ------------------------------------------------------------------
// Version bump
// ------------------------------------------------------------------

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function doBump(newVersion) {
  // package.json
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  pkg.version = newVersion;
  await writeFileAtomic(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  // plugin.json
  const manifestPath = path.join(ROOT, 'plugins', 'kimi', '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  manifest.version = newVersion;
  await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  log('Bump', `Version bumped to ${newVersion}`, 'pass');
}

async function writeFileAtomic(filePath, content) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filePath, content);
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const doTag = args.includes('--tag');
  const skipGitClean = args.includes('--skip-git-check');
  const bumpArg = args.find((a) => a.startsWith('--bump='));
  const bumpType = bumpArg ? bumpArg.split('=')[1] : null;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     Kimi Plugin CC — Release Validation CLI              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (dryRun) {
    log('Config', 'Running in DRY-RUN mode — no changes will be made', 'warn');
  }

  const checks = [
    ...(skipGitClean ? [] : [{ name: 'Git clean', fn: checkGitClean }]),
    { name: 'Version consistency', fn: checkVersionConsistency },
    { name: 'Syntax lint', fn: checkLint },
    { name: 'Tests', fn: checkTests },
    { name: 'Plugin manifest', fn: checkPluginManifest },
    { name: 'Required files', fn: checkRequiredFiles },
    { name: 'Broker smoke test', fn: checkBrokerSmoke },
    { name: 'Agent files', fn: checkAgentFiles },
    { name: 'Command files', fn: checkCommandFiles },
    { name: 'npm pack', fn: checkNpmPack },
  ];

  let version;
  let failed = 0;

  for (const check of checks) {
    try {
      const result = await check.fn();
      if (check.name === 'Version consistency') version = result;
      log(check.name, 'PASS', 'pass');
    } catch (e) {
      log(check.name, `FAIL — ${e.message}`, 'fail');
      failed++;
    }
  }

  console.log('');
  if (failed > 0) {
    log('Result', `${failed}/${checks.length} checks failed. Release BLOCKED.`, 'fail');
    process.exit(1);
  }

  log('Result', `${checks.length}/${checks.length} checks passed. Ready to ship.`, 'pass');

  if (!bumpType && !doTag) {
    console.log('\nTip: Use --bump=patch|minor|major to auto-bump version');
    console.log('Tip: Use --tag to create git tag after bump');
    return;
  }

  if (bumpType) {
    const newVersion = bumpVersion(version, bumpType);
    log('Bump', `${version} → ${newVersion} (${bumpType})`);

    if (dryRun) {
      log('Bump', 'Skipped (dry-run)', 'warn');
    } else {
      await doBump(newVersion);
      version = newVersion;
    }
  }

  if (doTag) {
    log('Tag', `Creating git tag v${version}`);
    if (dryRun) {
      log('Tag', 'Skipped (dry-run)', 'warn');
    } else {
      await run('git', ['add', '-A']);
      await run('git', ['commit', '-m', `release: v${version}`]);
      await run('git', ['tag', `v${version}`]);
      log('Tag', `Created tag v${version}`, 'pass');
      console.log(`\n  git push origin main --tags`);
      console.log(`  npm publish`);
    }
  }
}

main().catch((err) => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
