import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { backupJsonFile, ensureGatewayToken, upsertRuntimeConfig } from './config-merge.mjs';

describe('config merge runtime defaults', () => {
  it('enables gateway chat completions http endpoint during runtime setup', () => {
    const next = upsertRuntimeConfig({}, {
      apiKeyValue: 'sk-modelhub',
      providerId: 'modelhub',
      serviceBaseUrl: 'https://www.modelhub.com.br',
    });

    expect(next.gateway).toMatchObject({
      http: {
        endpoints: {
          chatCompletions: {
            enabled: true,
          },
        },
      },
      mode: 'local',
    });
  });

  it('preserves existing gateway http settings while forcing chat completions on', () => {
    const result = ensureGatewayToken({
      gateway: {
        auth: {
          token: 'existing-token',
        },
        http: {
          endpoints: {
            chatCompletions: {
              maxBodyBytes: 1234,
            },
            responses: {
              enabled: true,
            },
          },
        },
      },
    });

    expect(result.config.gateway.http.endpoints.chatCompletions).toEqual({
      enabled: true,
      maxBodyBytes: 1234,
    });
    expect(result.config.gateway.http.endpoints.responses).toEqual({
      enabled: true,
    });
  });

  it('sanitizes legacy provider models before starting the gateway', () => {
    const next = upsertRuntimeConfig({
      models: {
        providers: {
          modelhub: {
            models: [
              {
                alias: 'GPT OSS 20B Alias',
                extra: 'ignore-me',
                id: 'openrouter/openai/gpt-oss-20b:free',
                input: ['text', 'audio', 'image'],
                name: 'GPT OSS 20B',
                reasoning: true,
              },
            ],
          },
        },
      },
    }, {
      apiKeyValue: 'sk-modelhub',
      providerId: 'modelhub',
      serviceBaseUrl: 'https://www.modelhub.com.br',
    });

    expect(next.models.providers.modelhub.models).toEqual([
      {
        id: 'openrouter/openai/gpt-oss-20b:free',
        input: ['text', 'image'],
        name: 'GPT OSS 20B',
        reasoning: true,
      },
    ]);
  });

  it('sets credential-bearing backup files to owner-only permissions on POSIX', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openclaw-config-'));
    const filePath = path.join(dir, 'openclaw.json');
    await writeFile(filePath, '{"models":{}}\n', { mode: 0o600 });

    const backupPath = await backupJsonFile(filePath);

    expect(backupPath).toEqual(expect.stringContaining('openclaw.json.'));
    if (process.platform !== 'win32') {
      const mode = (await stat(backupPath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});
