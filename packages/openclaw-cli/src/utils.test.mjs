import { describe, expect, it } from 'vitest';

import { normalizeBaseUrl, normalizeServiceBaseUrl } from './utils.mjs';

describe('normalizeBaseUrl', () => {
  it('removes trailing slashes without changing the core URL', () => {
    expect(normalizeBaseUrl('https://www.modelhub.com.br///')).toBe('https://www.modelhub.com.br');
    expect(normalizeBaseUrl(' http://127.0.0.1:18789/ ')).toBe('http://127.0.0.1:18789');
  });
});

describe('normalizeServiceBaseUrl', () => {
  it('removes a trailing /v1 suffix', () => {
    expect(normalizeServiceBaseUrl('https://www.modelhub.com.br/v1')).toBe('https://www.modelhub.com.br');
    expect(normalizeServiceBaseUrl('https://www.modelhub.com.br/v1/')).toBe('https://www.modelhub.com.br');
  });

  it('preserves other path segments', () => {
    expect(normalizeServiceBaseUrl('https://www.modelhub.com.br/openclaw')).toBe('https://www.modelhub.com.br/openclaw');
  });
});
