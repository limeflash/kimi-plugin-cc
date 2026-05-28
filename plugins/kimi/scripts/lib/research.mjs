import { readFile } from 'node:fs/promises';
import { warn } from './warn.mjs';

const RESEARCH_CAP_BYTES = 2 * 1024; // 2KB cap

/**
 * Extract research topics from a task spec.
 *
 * @param {string} taskContent - markdown content
 * @returns {string[]}
 */
export function extractResearchTopics(taskContent) {
  const topics = [];

  // Explicit frontmatter
  const match = taskContent.match(/research_topics:\s*\n((?:\s+-\s+.*\n?)+)/);
  if (match) {
    const lines = match[1].split('\n').filter((l) => l.trim().startsWith('-'));
    for (const line of lines) {
      const v = line.replace(/^\s+-\s+/, '').trim();
      if (v) topics.push(v);
    }
  }

  // Heuristic: title + first paragraph keywords
  if (topics.length === 0) {
    const title = taskContent.match(/^title:\s*(.+)$/m)?.[1]?.trim() || '';
    const firstPara = taskContent.split('\n\n')[0] || '';
    const combined = `${title} ${firstPara}`;
    // Extract capitalized tech terms (naive heuristic)
    const techTerms = combined.match(/\b[A-Z][a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*\b/g) || [];
    for (const t of [...new Set(techTerms)]) {
      if (t.length > 2 && !['The', 'This', 'That', 'With', 'From', 'For', 'And'].includes(t)) {
        topics.push(t);
      }
    }
  }

  return [...new Set(topics)].slice(0, 5);
}

/**
 * Research topics via Tavily.
 *
 * @param {string[]} topics
 * @returns {Promise<string>}
 */
export async function researchTopics(topics) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    await warn('research', 'TAVILY_API_KEY not set — skipping web research', 'info');
    return '';
  }

  const query = topics.join(' ');
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${query} best practices 2025 2026`,
        search_depth: 'basic',
        max_results: 3,
        include_answer: true,
      }),
    });
    const data = await res.json();
    const answer = data.answer || '';
    if (!answer) return '';

    const summary = `=== CURRENT CONTEXT (read-only reference) ===\n\n${answer.slice(0, RESEARCH_CAP_BYTES)}${answer.length > RESEARCH_CAP_BYTES ? '...' : ''}\n`;
    return summary;
  } catch (e) {
    await warn('research', e, 'warning');
    return '';
  }
}
