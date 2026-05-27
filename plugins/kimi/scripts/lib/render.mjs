/**
 * Render structured review / explore findings into readable markdown.
 */

export function renderReview(findings) {
  if (!findings || findings.length === 0) {
    return '**No issues found.**';
  }

  const bySeverity = { critical: [], warning: [], info: [] };
  for (const f of findings) {
    const sev = (f.severity || 'info').toLowerCase();
    bySeverity[sev] = bySeverity[sev] || [];
    bySeverity[sev].push(f);
  }

  let md = '';
  for (const sev of ['critical', 'warning', 'info']) {
    const items = bySeverity[sev] || [];
    if (items.length === 0) continue;
    const emoji = sev === 'critical' ? '🔴' : sev === 'warning' ? '🟡' : '🔵';
    md += `\n### ${emoji} ${sev.toUpperCase()} (${items.length})\n\n`;
    for (const f of items) {
      md += `- **${f.file}${f.line ? `:${f.line}` : ''}** — ${f.message}\n`;
      if (f.suggestion) md += `  → *Suggestion:* ${f.suggestion}\n`;
    }
  }
  return md.trim();
}

export function renderExplore(result) {
  const { summary, healthScore, techStack, insights } = result;
  let md = `## 🎯 Executive Summary\n\n${summary || 'No summary provided.'}\n\n`;
  if (healthScore) {
    md += `### Health Score: ${healthScore}/10\n\n`;
  }
  if (techStack) {
    md += `### Tech Stack\n\n| Layer | Technology |\n|-------|------------|\n`;
    for (const [layer, tech] of Object.entries(techStack)) {
      md += `| ${layer} | ${tech} |\n`;
    }
    md += '\n';
  }
  if (insights && insights.length) {
    md += `### Key Insights\n\n`;
    for (const i of insights) {
      md += `- **${i.type}:** ${i.message}\n`;
    }
  }
  return md;
}
