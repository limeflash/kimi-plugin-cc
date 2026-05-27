import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

function getPluginRoot() {
  return process.env.KIMI_PLUGIN_DATA
    ? path.join(process.env.KIMI_PLUGIN_DATA)
    : path.join(process.env.HOME, '.kimi-plugin-cc');
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf-8' }, (err, stdout, stderr) => {
      if (err && !stdout) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Capture pre/post diff for a session.
 */
export async function captureDiff(sessionId, phase, repoPath = process.cwd()) {
  const sessDir = path.join(getPluginRoot(), 'sessions', sessionId);
  await mkdir(sessDir, { recursive: true });

  const diff = await runGit(['diff', 'HEAD'], repoPath).catch(() => '');
  const status = await runGit(['status', '--short'], repoPath).catch(() => '');

  await writeFile(path.join(sessDir, `${phase}.diff`), diff);
  await writeFile(path.join(sessDir, `${phase}.status`), status);
}

/**
 * Get diff against a base ref.
 */
export async function getBranchDiff(baseRef, repoPath = process.cwd()) {
  return runGit(['diff', `${baseRef}...HEAD`], repoPath).catch(() => '');
}

/**
 * Get diff of uncommitted changes.
 */
export async function getWorkingDiff(repoPath = process.cwd()) {
  return runGit(['diff'], repoPath).catch(() => '');
}

/**
 * Find the repository root.
 */
export async function findRepoRoot(start = process.cwd()) {
  try {
    const out = await runGit(['rev-parse', '--show-toplevel'], start);
    return out.trim();
  } catch {
    return start;
  }
}
