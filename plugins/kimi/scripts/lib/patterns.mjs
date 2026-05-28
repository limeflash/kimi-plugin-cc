import { warn } from './warn.mjs';

const PATTERNS_CAP_BYTES = 3 * 1024; // 3KB cap

/**
 * Search for real-world code patterns via Exa semantic search.
 *
 * @param {string[]} keywords
 * @returns {Promise<string>}
 */
export async function searchPatterns(keywords) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    await warn('patterns', 'EXA_API_KEY not set — skipping pattern search', 'info');
    return '';
  }

  const query = keywords.join(' ');
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: `${query} implementation code example`,
        type: 'auto',
        numResults: 5,
        contents: { highlights: { maxCharacters: 800 } },
      }),
    });
    const data = await res.json();
    const results = data.results || [];
    if (results.length === 0) return '';

    const blocks = [];
    for (const r of results) {
      const hl = r.highlights?.[0] || '';
      if (hl) {
        blocks.push(`// From: ${r.url}\n${hl.slice(0, 600)}`);
      }
    }

    if (blocks.length === 0) return '';

    let assembled = '=== CODE PATTERNS (read-only reference) ===\n\n';
    for (const b of blocks) {
      if (assembled.length + b.length > PATTERNS_CAP_BYTES) {
        assembled += '\n... (truncated)\n';
        break;
      }
      assembled += b + '\n\n';
    }
    return assembled.trimEnd() + '\n';
  } catch (e) {
    await warn('patterns', e, 'warning');
    return '';
  }
}
