import path from 'node:path';

const UNSUPPORTED_METACHARS = /[{}()!+@\[\]]/;

export function matchGlob(filePath, pattern) {
  const unsupported = pattern.match(UNSUPPORTED_METACHARS);
  if (unsupported) {
    throw new Error(
      `Unsupported glob metachar '${unsupported[0]}' in pattern '${pattern}'. ` +
      `Supported: '*', '**', '?', literal chars. ` +
      `Extglobs ({a,b}, !(x), +(x), @(x)) and character classes ([abc]) are not supported.`
    );
  }
  return path.matchesGlob(filePath, pattern);
}
