import test from 'node:test';
import assert from 'node:assert/strict';

import { renderReview, renderExplore } from '../plugins/kimi/scripts/lib/render.mjs';

test('renderReview returns no-issues message for empty input', () => {
  const out = renderReview([]);
  assert.match(out, /No issues found/);
});

test('renderReview returns no-issues message for null input', () => {
  const out = renderReview(null);
  assert.match(out, /No issues found/);
});

test('renderReview groups findings by severity', () => {
  const findings = [
    { severity: 'critical', file: 'auth.ts', line: 42, message: 'SQL injection', suggestion: 'Use parameterized queries' },
    { severity: 'warning', file: 'api.ts', line: 10, message: 'Missing error handler' },
    { severity: 'info', file: 'utils.ts', message: 'Consider caching' },
  ];
  const out = renderReview(findings);
  assert.match(out, /CRITICAL/);
  assert.match(out, /WARNING/);
  assert.match(out, /INFO/);
  assert.match(out, /auth.ts:42/);
  assert.match(out, /SQL injection/);
  assert.match(out, /Use parameterized queries/);
});

test('renderExplore produces summary section', () => {
  const out = renderExplore({ summary: 'This is a great project.' });
  assert.match(out, /Executive Summary/);
  assert.match(out, /This is a great project./);
});

test('renderExplore includes health score when provided', () => {
  const out = renderExplore({ summary: 'OK', healthScore: 8 });
  assert.match(out, /Health Score: 8\/10/);
});

test('renderExplore includes tech stack table', () => {
  const out = renderExplore({
    summary: 'OK',
    techStack: { frontend: 'React', backend: 'Node.js' },
  });
  assert.match(out, /Tech Stack/);
  assert.match(out, /React/);
  assert.match(out, /Node.js/);
});

test('renderExplore includes insights list', () => {
  const out = renderExplore({
    summary: 'OK',
    insights: [
      { type: 'Architecture', message: 'Clean separation of concerns' },
    ],
  });
  assert.match(out, /Key Insights/);
  assert.match(out, /Clean separation of concerns/);
});
