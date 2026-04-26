import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE_DIR = path.resolve('packages/openclaw-cli/src');
const SEMVER_LITERAL_RE = /(?<!\d\.)\b\d+\.\d+\.\d+\b(?!\.\d)/g;

async function collectProductionModules(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectProductionModules(fullPath));
    } else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('openclaw cli version literals', () => {
  it('does not hardcode semver strings in production .mjs files', async () => {
    const matches = [];
    for (const filePath of await collectProductionModules(SOURCE_DIR)) {
      const source = stripComments(await readFile(filePath, 'utf8'));
      const found = source.match(SEMVER_LITERAL_RE) ?? [];
      for (const literal of found) {
        matches.push(`${path.relative(SOURCE_DIR, filePath)}: ${literal}`);
      }
    }

    expect(matches).toEqual([]);
  });
});
