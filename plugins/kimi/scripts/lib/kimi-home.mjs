import { mkdir, readFile, writeFile, rename, symlink, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * kimi-code invocation policy: binary resolution, read-only enforcement, and
 * the ephemeral KIMI_CODE_HOME that carries it.
 *
 * kimi-code (the TypeScript CLI, >= 0.26.0) has no `--agent-file`. In prompt
 * mode (`-p`) the permission mode is forced to `auto` and anything that would
 * "ask" is auto-approved by the headless approval handler
 * (apps/kimi-code/src/cli/run-prompt.ts: installHeadlessHandlers). The ONLY
 * hard gate that survives `-p` is a user-configured `deny` permission rule:
 * UserConfiguredDenyPermissionPolicy is evaluated BEFORE AutoModeApprove
 * (packages/agent-core/src/agent/permission/policies/index.ts), and the policy
 * chain checks all deny rules before any allow rule, so a deny always wins.
 *
 * Read-only sessions therefore run under an ephemeral KIMI_CODE_HOME whose
 * config.toml is the user's config plus a single fail-CLOSED deny rule that
 * matches every tool NOT in the read allow-set. Because the home is ephemeral,
 * the user's global mcp.json and [[hooks]] never load into read-only runs
 * either, and project-level MCP tools (named `mcp__server__tool`) are caught
 * by the same deny rule.
 */

// kimi-code built-in read tools (0.26.0 names) that read-only sessions may use.
export const READ_ONLY_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'ReadMediaFile'];

/**
 * Fail-CLOSED deny pattern: matches any tool name NOT in the allow-set, so a
 * NEW tool added in a future kimi-code version (or any MCP/plugin/skill tool)
 * is denied by default.
 *
 * Brace negation `!{a,b}` is load-bearing. The permission-rule DSL parser
 * (matches-rule.ts parsePattern) splits on the FIRST "(", so the extglob form
 * `!(a|b)` parses as tool name "!" plus an arg pattern and never matches
 * anything — silently fail-open. `!{...}` has no parens and goes through
 * picomatch intact (verified empirically against picomatch 2.3.2, the version
 * in kimi-code's lockfile: allowed names don't match, everything else does).
 */
export function readOnlyDenyPattern() {
  return `!{${READ_ONLY_ALLOWED_TOOLS.join(',')}}`;
}

const DENY_BLOCK_MARKER = '# --- managed by kimi-plugin-cc (read-only session) ---';

export function buildReadOnlyDenyBlock() {
  return [
    DENY_BLOCK_MARKER,
    '# Fail-closed read-only gate: deny every tool that is not a read tool.',
    '# Deny rules beat allow rules and auto-approval in kimi-code, including',
    '# in `-p` (print) mode, so this is the hard guarantee for /kimi:explore,',
    '# /kimi:review and /kimi:challenge.',
    '[[permission.rules]]',
    'decision = "deny"',
    `pattern = "${readOnlyDenyPattern()}"`,
    'reason = "kimi-plugin-cc read-only session: only read tools are permitted"',
    '',
  ].join('\n');
}

/**
 * Policy selector, keyed off the legacy agent-file path that the slash
 * commands already pass to the broker. Fail-closed: only the coder agents get
 * full access; anything else (explore, plan, or an unknown/typoed file) runs
 * read-only.
 */
export function isReadOnlyAgentFile(agentFile) {
  const base = path.basename(String(agentFile || ''));
  return !/^coder(-sub)?\.ya?ml$/i.test(base);
}

/** The user's real kimi-code data dir (config + OAuth credentials). */
export function getUserKimiCodeHome() {
  return process.env.KIMI_CODE_USER_HOME
    || process.env.KIMI_CODE_HOME
    || path.join(os.homedir(), '.kimi-code');
}

/**
 * Resolve the kimi-code binary. The installer puts it at ~/.kimi-code/bin/kimi
 * without necessarily adding it to PATH, so: KIMI_BIN env override → `kimi` on
 * PATH (keeps test shims working) → the default install location.
 */
export function resolveKimiBin() {
  if (process.env.KIMI_BIN) return process.env.KIMI_BIN;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, 'kimi'))) return 'kimi';
  }
  const installed = path.join(os.homedir(), '.kimi-code', 'bin', 'kimi');
  if (existsSync(installed)) return installed;
  return 'kimi';
}

/**
 * Build (or refresh) the ephemeral read-only KIMI_CODE_HOME under the plugin
 * data dir. Regenerated from the user's live config on every spawn so config
 * edits (model changes, new providers) are picked up; written atomically via
 * tmp+rename so a concurrent read-only run never sees a partial file.
 *
 * The user's `credentials/` dir is symlinked, not copied: OAuth token refresh
 * writes go through the symlink into the real store, so the ephemeral home
 * never holds a stale or forked credential.
 *
 * @param {string} pluginRoot - plugin data root (e.g. ~/.kimi-plugin-cc)
 * @returns {Promise<{homeDir: string, emptySkillsDir: string}>}
 */
export async function prepareReadOnlyHome(pluginRoot) {
  const homeDir = path.join(pluginRoot, 'kimi-home-readonly');
  await mkdir(homeDir, { recursive: true });

  const userHome = getUserKimiCodeHome();
  let baseConfig = '';
  try {
    baseConfig = await readFile(path.join(userHome, 'config.toml'), 'utf-8');
  } catch {
    // No user config: still enforce the deny rules; kimi-code itself will
    // report the missing model/provider with a clear error.
  }
  const config = `${baseConfig.trimEnd()}\n\n${buildReadOnlyDenyBlock()}`;
  const configPath = path.join(homeDir, 'config.toml');
  const tmpPath = `${configPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, config);
  await rename(tmpPath, configPath);

  const credSrc = path.join(userHome, 'credentials');
  const credDst = path.join(homeDir, 'credentials');
  try {
    await lstat(credDst); // already linked (or user placed something) — leave it
  } catch {
    if (existsSync(credSrc)) {
      try { await symlink(credSrc, credDst); } catch { /* raced with a concurrent run */ }
    }
  }

  // `--skills-dir` REPLACES skill auto-discovery; pointing it at an empty dir
  // keeps user/project skills out of read-only runs.
  const emptySkillsDir = path.join(homeDir, 'skills-empty');
  await mkdir(emptySkillsDir, { recursive: true });

  return { homeDir, emptySkillsDir };
}

/**
 * argv for one non-interactive kimi-code run. Replaces the legacy
 * `--print --yolo --work-dir X --agent-file Y`: the workspace is the spawn
 * cwd, `-p` implies non-interactive auto-permission mode, and the tool policy
 * travels via KIMI_CODE_HOME (see prepareReadOnlyHome) instead of a flag.
 */
export function buildKimiArgs(opts) {
  const args = ['--output-format', 'stream-json'];
  if (opts.model) args.push('-m', opts.model);
  if (opts.kimiSessionId) args.push('-S', opts.kimiSessionId);
  if (opts.emptySkillsDir) args.push('--skills-dir', opts.emptySkillsDir);
  args.push('-p', opts.prompt);
  return args;
}

/**
 * Environment for one kimi-code run. Auto-update is always disabled (a crank
 * must not block on an update prompt); read-only runs additionally point
 * KIMI_CODE_HOME at the ephemeral home and disable telemetry.
 */
export function buildKimiSpawnEnv(opts = {}) {
  const env = { ...process.env, KIMI_CODE_NO_AUTO_UPDATE: '1' };
  if (opts.readOnlyHome) {
    env.KIMI_CODE_HOME = opts.readOnlyHome;
    env.KIMI_DISABLE_TELEMETRY = '1';
  }
  return env;
}
