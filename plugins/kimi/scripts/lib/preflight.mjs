import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const SIDE_EFFECT_PATTERNS = [
  /\bgit\s+(commit|push|merge|rebase|reset|clean)\b/,
  /\brm\s+-rf\b/,
  /\bwriteFile\b/,
  /\bmv\s+/,
  />\s*\S+/, // redirection to file
  /\bchmod\s+/,
  /\bchown\s+/,
];

function hasSideEffects(script) {
  return SIDE_EFFECT_PATTERNS.some((p) => p.test(script));
}

/**
 * Run pre-flight checks on a task spec before dispatch.
 *
 * @param {string} taskPath - absolute path to the task markdown file
 * @param {string} repoRoot - absolute path to repo root
 * @returns {Promise<{status: string, findings: string[]}>}
 */
export async function preflight(taskPath, repoRoot) {
  const findings = [];

  // 1. Basic file readability
  let content;
  try {
    content = await readFile(taskPath, 'utf-8');
  } catch (e) {
    return { status: 'buggy-evals', findings: [`Cannot read task file: ${e.message}`] };
  }

  // 2. Check for format_version in frontmatter
  if (!content.includes('format_version:')) {
    findings.push('Missing format_version in frontmatter');
  }

  // 3. Brittle-sample heuristics in eval blocks
  const evalBlockPattern = /```bash\s*([\s\S]*?)```/g;
  let m;
  while ((m = evalBlockPattern.exec(content)) !== null) {
    const block = m[1];
    if (block.includes('mktemp -t') && block.includes('*.md')) {
      findings.push('Brittle eval: mktemp -t *.md may pollute filenames');
    }
    if (block.includes('mktemp') && !block.includes('>/dev/null')) {
      // Heuristic only; not a blocker on its own
    }
  }

  // 4. touches_paths sanity — must reference paths inside repo
  const tpMatch = content.match(/touches_paths:\s*\n((?:\s+-\s+.*\n?)+)/);
  if (tpMatch) {
    const lines = tpMatch[1].split('\n').filter((l) => l.trim().startsWith('-'));
    for (const line of lines) {
      const p = line.replace(/^\s+-\s+/, '').trim();
      if (p.startsWith('/tmp') || p.startsWith('/var/tmp')) {
        findings.push(`touches_paths references tmpdir: ${p}`);
      }
    }
  }

  // 5. Dry-run evals: run the exit check if extractable and safe
  const exitMatch = content.match(/```bash\s*\n#\s*Exit Check\s*\n([\s\S]*?)```/);
  if (exitMatch) {
    const script = exitMatch[1].trim();
    if (hasSideEffects(script)) {
      findings.push('Exit check has side effects — skipping dry-run');
    } else {
      // Run in a temp sandbox to prevent repo mutation
      const tmpDir = os.tmpdir();
      try {
        const result = await new Promise((resolve) => {
          execFile('bash', ['-c', script], { cwd: tmpDir, timeout: 15000 }, (err, stdout, stderr) => {
            resolve({ ok: !err, stdout, stderr });
          });
        });
        if (result.ok) {
          findings.push('Evals already pass — task may be already-done');
          return { status: 'already-done', findings };
        }
      } catch {
        // ignore dry-run errors
      }
    }
  }

  // 6. Shellcheck evals if validate-task-spec.sh available
  const validator = path.join(repoRoot, '.claude', 'skills', 'task-spec', 'scripts', 'validate-task-spec.sh');
  try {
    await readFile(validator);
    const scResult = await new Promise((resolve) => {
      execFile('bash', [validator, '--shellcheck-evals', taskPath], { cwd: repoRoot, timeout: 15000 }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout, stderr });
      });
    });
    if (!scResult.ok) {
      findings.push(`validate-task-spec --shellcheck-evals failed: ${scResult.stderr || scResult.stdout}`);
    }
  } catch {
    // validator not installed — skip
  }

  if (findings.length > 0) {
    return { status: 'buggy-evals', findings };
  }

  return { status: 'clean', findings: [] };
}
