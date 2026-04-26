import { describe, expect, it } from 'vitest';

import { extractBearerToken, timingSafeEqualToken } from './bridge-shared.mjs';

describe('extractBearerToken', () => {
  it('returns the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('bearer abc123')).toBe('abc123');
  });

  it('handles tabs and multiple spaces between scheme and token', () => {
    expect(extractBearerToken('Bearer\tabc123')).toBe('abc123');
    expect(extractBearerToken('Bearer    abc123')).toBe('abc123');
  });

  it('returns empty string for non-bearer or missing tokens', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBe('');
    expect(extractBearerToken('Bearer')).toBe('');
    expect(extractBearerToken('')).toBe('');
    expect(extractBearerToken(null)).toBe('');
    expect(extractBearerToken(undefined)).toBe('');
  });

  it('returns empty string for whitespace-only token (no ReDoS)', () => {
    // Antes do fix, "Bearer " + N espacos disparava backtracking polinomial
    // do regex /^Bearer\s+(.+)$/i. Verificamos que termina rapidamente e
    // retorna '' (token vazio nao deve passar).
    const start = Date.now();
    const padded = 'Bearer ' + ' '.repeat(50_000);
    expect(extractBearerToken(padded)).toBe('');
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('preserves embedded whitespace in the token but trims edges', () => {
    expect(extractBearerToken('Bearer abc  ')).toBe('abc');
    expect(extractBearerToken('  Bearer abc  ')).toBe('abc');
  });
});

describe('timingSafeEqualToken', () => {
  it('returns true only for byte-identical strings of equal length', () => {
    expect(timingSafeEqualToken('abc', 'abc')).toBe(true);
    expect(timingSafeEqualToken('abc', 'abd')).toBe(false);
    expect(timingSafeEqualToken('abc', 'abcd')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(timingSafeEqualToken('', '')).toBe(false);
    expect(timingSafeEqualToken('abc', '')).toBe(false);
    expect(timingSafeEqualToken(null, 'abc')).toBe(false);
  });
});
