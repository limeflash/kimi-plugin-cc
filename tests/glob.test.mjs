import test from 'node:test';
import assert from 'node:assert/strict';
import { matchGlob } from '../plugins/kimi/scripts/lib/glob.mjs';

test('matchGlob matches T-*.md basename pattern', () => {
  assert.equal(matchGlob('T-001.md', 'T-*.md'), true);
  assert.equal(matchGlob('T-20260528-foo.md', 'T-*.md'), true);
  assert.equal(matchGlob('R-001.md', 'T-*.md'), false);
});

test('matchGlob matches src/** scope pattern', () => {
  assert.equal(matchGlob('src/core/parsers/adf.py', 'src/**'), true);
  assert.equal(matchGlob('src/handlers/lambda.py', 'src/**'), true);
  assert.equal(matchGlob('tests/unit/foo.py', 'src/**'), false);
});

test('matchGlob matches nested **/sub-globs', () => {
  assert.equal(matchGlob('src/core/parsers/adf.py', 'src/core/parsers/**'), true);
  assert.equal(matchGlob('src/core/models/adf.py', 'src/core/parsers/**'), false);
});

test('matchGlob matches literal patterns', () => {
  assert.equal(matchGlob('foo.bar', 'foo.bar'), true);
  assert.equal(matchGlob('foo.baz', 'foo.bar'), false);
});

test('matchGlob throws on brace expansion', () => {
  assert.throws(() => matchGlob('x', 'foo{a,b}'), /Unsupported glob metachar '\{'/);
});

test('matchGlob throws on negation', () => {
  assert.throws(() => matchGlob('x', '!foo'), /Unsupported glob metachar '!'/);
});

test('matchGlob throws on character class', () => {
  assert.throws(() => matchGlob('x', 'foo[abc]'), /Unsupported glob metachar '\['/);
});

test('matchGlob throws on extglob plus', () => {
  assert.throws(() => matchGlob('x', '+(foo)'), /Unsupported glob metachar '\+'/);
});

test('matchGlob throws on extglob at', () => {
  assert.throws(() => matchGlob('x', '@(foo)'), /Unsupported glob metachar '@'/);
});

test('matchGlob throws on parens (extglob group)', () => {
  assert.throws(() => matchGlob('x', '(foo)'), /Unsupported glob metachar '\('/);
});

test('matchGlob throws message names the offending pattern and char', () => {
  try {
    matchGlob('x', 'foo{a,b}.md');
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /\{/);
    assert.match(e.message, /foo\{a,b\}\.md/);
  }
});
