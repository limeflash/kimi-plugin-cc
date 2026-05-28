import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { warn } from './warn.mjs';

/**
 * Capture a baseline snapshot of external docs via Firecrawl.
 *
 * @param {string} url
 * @param {string} snapshotDir
 * @returns {Promise<{snapshotFile: string, content: string}|null>}
 */
export async function captureBaseline(url, snapshotDir) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    await warn('monitor', 'FIRECRAWL_API_KEY not set — skipping doc monitor', 'info');
    return null;
  }

  await mkdir(snapshotDir, { recursive: true });
  const snapshotFile = path.join(snapshotDir, `snapshot-${hashUrl(url)}.json`);

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        changeTracking: true,
        timeout: 30000,
      }),
    });
    const data = await res.json();
    if (!data.success) return null;

    const snapshot = {
      url,
      captured_at: new Date().toISOString(),
      markdown: data.data?.markdown || '',
      metadata: data.data?.metadata || {},
    };
    await writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));
    return { snapshotFile, content: snapshot.markdown };
  } catch (e) {
    await warn('monitor', e, 'warning');
    return null;
  }
}

/**
 * Compare current docs against baseline snapshot.
 *
 * @param {string} url
 * @param {string} snapshotDir
 * @returns {Promise<{changed: boolean, diff: string}|null>}
 */
export async function checkForChanges(url, snapshotDir) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;

  const snapshotFile = path.join(snapshotDir, `snapshot-${hashUrl(url)}.json`);
  let baseline;
  try {
    baseline = JSON.parse(await readFile(snapshotFile, 'utf-8'));
  } catch {
    return null;
  }

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        changeTracking: true,
        timeout: 30000,
      }),
    });
    const data = await res.json();
    if (!data.success) return null;

    const current = data.data?.markdown || '';
    const changed = current !== baseline.markdown;
    return { changed, diff: changed ? `Content changed since ${baseline.captured_at}` : '' };
  } catch (e) {
    await warn('monitor', e, 'warning');
    return null;
  }
}

function hashUrl(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
