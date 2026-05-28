import { warn } from './warn.mjs';

/**
 * Extract potential new API references from a diff.
 *
 * @param {string} diff
 * @returns {string[]}
 */
export function extractApiReferences(diff) {
  const refs = [];
  const lines = diff.split('\n');

  for (const line of lines) {
    if (!line.startsWith('+')) continue;
    const content = line.slice(1);

    // HTTP endpoint patterns
    const urlMatch = content.match(/https?:\/\/[^\s"'`]+/);
    if (urlMatch) refs.push(urlMatch[0]);

    // New import patterns
    const importMatch = content.match(/(?:import\s+.*?\s+from\s+['"])([^'"./][^'"]*)(?:['"])/);
    if (importMatch) refs.push(importMatch[1]);

    // Method chains on known libraries (e.g., stripe.charges.create)
    const methodMatch = content.match(/\b(\w+\.\w+(?:\.\w+)+)\s*\(/);
    if (methodMatch) refs.push(methodMatch[1]);
  }

  return [...new Set(refs)].slice(0, 10);
}

/**
 * Validate API references via Tavily search.
 *
 * @param {string[]} refs
 * @returns {Promise<{valid: boolean, concerns: string[]}>}
 */
export async function validateApiReferences(refs) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    await warn('validate-api', 'TAVILY_API_KEY not set — skipping API validation', 'info');
    return { valid: true, concerns: [] };
  }

  const concerns = [];
  for (const ref of refs) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: `${ref} documentation API`,
          search_depth: 'basic',
          max_results: 2,
        }),
      });
      const data = await res.json();
      const results = data.results || [];
      if (results.length === 0) {
        concerns.push(`No docs found for: ${ref}`);
      }
    } catch (e) {
      await warn('validate-api', e, 'warning');
    }
  }

  return { valid: concerns.length === 0, concerns };
}
