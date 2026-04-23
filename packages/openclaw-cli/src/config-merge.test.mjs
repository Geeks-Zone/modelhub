import { describe, expect, it } from 'vitest';

import { ensureGatewayToken, upsertRuntimeConfig } from './config-merge.mjs';

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
});
