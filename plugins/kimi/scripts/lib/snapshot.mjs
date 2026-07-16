import { spawn, execFile } from 'node:child_process';
import { mkdir, writeFile, stat, rm, cp } from 'node:fs/promises';
import path from 'node:path';

/**
 * Filesystem isolation for read-only kimi runs — the backstop behind the
 * deny-rule gate (see kimi-home.mjs / SECURITY.md).
 *
 * A read-only session gets a SNAPSHOT WORKSPACE outside the repository:
 *
 *   git archive HEAD            → the committed tree (no .git inside)
 *   + git diff HEAD --binary    → uncommitted staged/unstaged changes
 *   + untracked non-ignored files (git ls-files --others --exclude-standard)
 *
 * kimi runs with the snapshot as its cwd, so even if the permission engine
 * ever failed, writes would land in the snapshot — never in the working tree.
 * Two properties fall out for free:
 *
 *   - No .git in the snapshot: nothing to push, no hooks, no repo mutation
 *     surface at all (Bash is deny-ruled anyway; this is depth).
 *   - Gitignored files (.env, node_modules, local secrets) are absent —
 *     kimi cannot read what is not there.
 *
 * Fallback: if the directory is not a git repo (or has no commits yet), we
 * cannot build a snapshot; the caller runs in place, still behind the deny
 * rule, and records the degradation in meta.
 */

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '', code: err?.code ?? 0 });
    });
  });
}

/** git archive HEAD | tar -x — streamed, no intermediate buffer limits. */
function archiveInto(repoPath, workspaceDir) {
  return new Promise((resolve) => {
    const git = spawn('git', ['-C', repoPath, 'archive', '--format=tar', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tar = spawn('tar', ['-x', '-C', workspaceDir], { stdio: ['pipe', 'ignore', 'pipe'] });
    git.stdout.pipe(tar.stdin);
    let gitErr = '';
    let tarErr = '';
    git.stderr.on('data', (d) => { gitErr += d; });
    tar.stderr.on('data', (d) => { tarErr += d; });
    git.on('error', () => resolve({ ok: false, error: 'git spawn failed' }));
    tar.on('error', () => resolve({ ok: false, error: 'tar spawn failed' }));
    let gitCode = null;
    const settle = (tarCode) => {
      if (gitCode !== 0 || tarCode !== 0) {
        resolve({ ok: false, error: (gitErr || tarErr || `exit ${gitCode}/${tarCode}`).trim() });
      } else {
        resolve({ ok: true });
      }
    };
    git.on('close', (code) => { gitCode = code ?? 1; });
    tar.on('close', (code) => settle(code ?? 1));
  });
}

/**
 * Build the snapshot workspace for one session.
 *
 * @param {string} repoPath - the real repository (or plain directory)
 * @param {string} sessDir - the plugin session dir; the snapshot lives inside
 *   it (`<sessDir>/workspace`) so its lifecycle is tied to the session.
 * @returns {Promise<{workspaceDir: string|null, warning: string}>}
 *   workspaceDir null → no snapshot possible; run in place (still deny-ruled).
 */
export async function prepareReadOnlySnapshot(repoPath, sessDir) {
  const head = await run('git', ['-C', repoPath, 'rev-parse', '--verify', 'HEAD']);
  if (!head.ok) {
    return {
      workspaceDir: null,
      warning: 'not a git repo (or no commits yet) — read-only run stays in place, deny rules only',
    };
  }

  const workspaceDir = path.join(sessDir, 'workspace');
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });

  const archived = await archiveInto(repoPath, workspaceDir);
  if (!archived.ok) {
    await rm(workspaceDir, { recursive: true, force: true });
    return {
      workspaceDir: null,
      warning: `git archive failed (${archived.error}) — read-only run stays in place, deny rules only`,
    };
  }

  let warning = '';

  // Overlay uncommitted (staged + unstaged) changes so reviews see the live
  // tree, not just HEAD. --binary keeps binary edits applyable; the patch is
  // written to the session dir to sidestep exec buffer limits on huge diffs.
  const patchFile = path.join(sessDir, 'workspace.patch');
  const diff = await run('git', ['-C', repoPath, 'diff', 'HEAD', '--binary']);
  if (diff.ok && diff.stdout.length > 0) {
    await writeFile(patchFile, diff.stdout);
    const applied = await run('git', ['apply', '--whitespace=nowarn', patchFile], { cwd: workspaceDir });
    if (!applied.ok) {
      warning = 'uncommitted diff did not apply cleanly — snapshot reflects HEAD plus untracked files only';
    }
    // The patch is a transient input, and it duplicates the user's uncommitted
    // work — don't leave it lying around in the session dir.
    await rm(patchFile, { force: true });
  } else if (!diff.ok) {
    warning = 'could not read the working diff — snapshot reflects HEAD plus untracked files only';
  }

  // Untracked, non-ignored files (new files a review typically cares about).
  // Ignored files are deliberately absent: .env & friends never reach kimi.
  const untracked = await run('git', ['-C', repoPath, 'ls-files', '--others', '--exclude-standard', '-z']);
  if (untracked.ok) {
    for (const rel of untracked.stdout.split('\0').filter(Boolean)) {
      const src = path.join(repoPath, rel);
      const dst = path.join(workspaceDir, rel);
      try {
        await mkdir(path.dirname(dst), { recursive: true });
        await cp(src, dst);
      } catch {
        // File vanished between listing and copy — skip.
      }
    }
  }

  return { workspaceDir, warning };
}

/**
 * Remove a snapshot workspace. Guarded: refuses anything not named
 * `workspace` so a corrupted meta value can never rm -rf a user path.
 */
export async function cleanupSnapshot(workspaceDir) {
  if (!workspaceDir || path.basename(workspaceDir) !== 'workspace') return;
  try {
    await stat(workspaceDir);
    await rm(workspaceDir, { recursive: true, force: true });
  } catch {
    // already gone
  }
}
