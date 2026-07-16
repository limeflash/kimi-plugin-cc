// secrets.mjs — best-effort secret detection for material sent to Kimi.
//
// The read-only commands (/kimi:review, /kimi:challenge, /kimi:explore) ship
// repo content (diffs, file bodies, prompts) to the Kimi CLI, which forwards it
// to Moonshot's API — a third party. This scans that material first so leaked
// credentials don't get shipped out. Best-effort, NOT a replacement for
// gitleaks/trufflehog — conservative patterns to keep false positives low.
//
// Ported from limeflash/antigravity-plugin-cc (the agy plugin). Two entries:
//   - scanTextForSecrets(text): scans raw text (a prompt, or the FULL content
//     of a file shipped as context — a secret on an unchanged line never
//     appears in a diff's `+` lines, so full content must be scanned too).
//   - scanDiffForSecrets(diff): scans only the ADDED lines of a unified diff.

const PATTERNS = [
  [/AKIA[0-9A-Z]{16}/i, "AWS access key"],
  [/ASIA[0-9A-Z]{16}/i, "AWS STS token"],
  [/gh[pousr]_[A-Za-z0-9]{36,}/i, "GitHub personal access token"],
  [/github_pat_[A-Za-z0-9_]{40,}/i, "GitHub fine-grained PAT"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/i, "Slack token"],
  // Modern API keys carry dashes after a specific prefix, so they need their
  // own patterns — the generic legacy `sk-<alnum>` below stops at the first
  // dash and would miss them. (Moonshot/Kimi keys are OpenAI-compatible `sk-`.)
  [/sk-ant-[A-Za-z0-9_-]{20,}/i, "Anthropic API key"],
  [/sk-proj-[A-Za-z0-9_-]{20,}/i, "OpenAI project key"],
  [/sk-[A-Za-z0-9]{20,}/i, "OpenAI/Moonshot-style API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, "PEM private key block"],
  [
    /(api[_-]?key|secret|token|password|access[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9_+/=\-]{16,}/i,
    "inline credential assignment",
  ],
];

/**
 * Scan raw text against the secret patterns. Returns an array of matched
 * pattern labels (empty if clean). Order of labels follows PATTERNS.
 */
export function scanTextForSecrets(text) {
  if (!text) return [];
  const hits = [];
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}

/**
 * Scan only the ADDED lines of a unified diff (lines starting with a single
 * `+`, excluding the `+++` file header). Returns matched pattern labels.
 */
export function scanDiffForSecrets(diff) {
  if (!diff) return [];
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  if (added.length === 0) return [];
  return scanTextForSecrets(added.join("\n"));
}
