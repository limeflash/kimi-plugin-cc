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

/**
 * Render a batch report as markdown table.
 *
 * @param {object[]} sessions
 * @returns {string}
 */
export function renderReport(sessions) {
  if (!sessions || sessions.length === 0) {
    return '**No sessions found.**';
  }

  const rows = sessions.map((s) => {
    const duration = s.started_at && s.finished_at
      ? Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 1000)
      : '-';
    const tokens = s.telemetry
      ? (s.telemetry.prompt_tokens || 0) + (s.telemetry.completion_tokens || 0)
      : '-';
    const cost = s.telemetry?.estimated_cost_usd ?? '-';
    return {
      id: s.session_id?.slice(0, 8) || '-',
      status: s.status || '?',
      duration,
      committed: s.committed ? 'yes' : 'no',
      commit_sha: s.commit_sha ? s.commit_sha.slice(0, 7) : '-',
      tokens,
      cost,
    };
  });

  let md = '## Batch Report\n\n';
  md += '| Session | Status | Duration | Committed | Commit | Tokens | Cost |\n';
  md += '|---------|--------|----------|-----------|--------|--------|------|\n';
  for (const r of rows) {
    md += `| ${r.id} | ${r.status} | ${r.duration}s | ${r.committed} | ${r.commit_sha} | ${r.tokens} | ${r.cost} |\n`;
  }

  // Footer totals
  const totalSessions = sessions.length;
  const totalDuration = sessions.reduce((sum, s) => {
    return sum + (s.started_at && s.finished_at
      ? (new Date(s.finished_at) - new Date(s.started_at)) / 1000
      : 0);
  }, 0);
  const totalTokens = sessions.reduce((sum, s) => {
    return sum + (s.telemetry
      ? (s.telemetry.prompt_tokens || 0) + (s.telemetry.completion_tokens || 0)
      : 0);
  }, 0);
  const totalCost = sessions.reduce((sum, s) => sum + (s.telemetry?.estimated_cost_usd || 0), 0);
  const completed = sessions.filter((s) => s.status === 'completed').length;
  const passRate = totalSessions > 0 ? Math.round((completed / totalSessions) * 1000) / 10 : 0;

  md += `\n**Totals:** ${totalSessions} sessions, ${Math.round(totalDuration)}s, ${totalTokens} tokens, $${Math.round(totalCost * 10000) / 10000}, ${passRate}% pass rate\n`;
  return md;
}
