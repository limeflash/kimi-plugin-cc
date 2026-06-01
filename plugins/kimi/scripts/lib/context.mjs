import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { matchGlob } from './glob.mjs';

const CONTEXT_CAP_BYTES = 8 * 1024; // 8KB total cap

/**
 * Discover project context files and assemble a preamble.
 *
 * @param {string[]} touchesPaths - relative or absolute paths the task touches
 * @param {string} repoRoot - absolute path to repo root
 * @returns {Promise<string>}
 */
export async function discoverContext(touchesPaths, repoRoot) {
  const blocks = [];

  // 1. CLAUDE.md at repo root
  const claudeMd = await readTextSafe(path.join(repoRoot, 'CLAUDE.md'));
  if (claudeMd) {
    blocks.push({ title: 'CLAUDE.md', content: claudeMd });
  }

  // 2. AGENTS.md at repo root
  const agentsMd = await readTextSafe(path.join(repoRoot, 'AGENTS.md'));
  if (agentsMd) {
    blocks.push({ title: 'AGENTS.md', content: agentsMd });
  }

  // 3. Scoped rules under .claude/rules/*.md
  const rulesDir = path.join(repoRoot, '.claude', 'rules');
  const ruleFiles = await listMdFilesSafe(rulesDir);
  for (const rf of ruleFiles) {
    const text = await readTextSafe(rf);
    if (!text) continue;
    const scope = extractScope(text, rf);
    if (scope && touchesPaths.some((tp) => matchScopedGlob(tp, scope))) {
      const truncated = truncateRule(text);
      blocks.push({ title: path.relative(repoRoot, rf), content: truncated });
    }
  }

  // Assemble with cap
  let assembled = '=== PROJECT CONTEXT (read-only reference) ===\n\n';
  let used = assembled.length;

  for (const b of blocks) {
    const header = `--- ${b.title} ---\n`;
    const piece = header + b.content + '\n\n';
    if (used + piece.length > CONTEXT_CAP_BYTES) {
      // Truncate content to fit
      const remaining = CONTEXT_CAP_BYTES - used - header.length - 4;
      if (remaining > 40) {
        assembled += header + b.content.slice(0, remaining) + '...\n\n';
      }
      break;
    }
    assembled += piece;
    used += piece.length;
  }

  return assembled.trimEnd() + '\n';
}

async function readTextSafe(filePath) {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function listMdFilesSafe(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function extractScope(text, filepath) {
  // Try frontmatter globs: ---\nglobs:\n  - "src/**"\n---
  const fm = text.match(/---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const globsMatch = fm[1].match(/globs:\s*\n((?:\s+-\s+.*\n?)+)/);
    if (globsMatch) {
      const lines = globsMatch[1].split('\n').filter((l) => l.trim().startsWith('-'));
      for (const line of lines) {
        const g = line.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '');
        if (g) return g;
      }
    }
  }
  // Fallback: filename-based (e.g., "src-core-parsers.md" -> "src/core/parsers/**")
  const base = path.basename(filepath, '.md');
  if (base.includes('-')) {
    const derived = base.replace(/-/g, '/');
    if (!derived.includes('*')) return derived + '/**';
  }
  return null;
}

function matchScopedGlob(filePath, glob) {
  const fp = filePath.replace(/^\//, '');
  return matchGlob(fp, glob);
}

function truncateRule(text) {
  // Keep first H1/H2 + first bullet list per section, cap at ~1KB
  const lines = text.split('\n');
  const out = [];
  let inSection = false;
  let bytes = 0;
  const maxBytes = 1024;
  for (const line of lines) {
    if (bytes > maxBytes) {
      out.push('...');
      break;
    }
    if (line.startsWith('# ')) {
      inSection = true;
      out.push(line);
      bytes += line.length + 1;
    } else if (line.startsWith('## ')) {
      inSection = true;
      out.push(line);
      bytes += line.length + 1;
    } else if (inSection && line.trim().startsWith('- ')) {
      out.push(line);
      bytes += line.length + 1;
    } else if (line.trim() === '') {
      out.push(line);
      bytes += 1;
    }
  }
  return out.join('\n');
}
