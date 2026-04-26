import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildProviderBaseUrl,
  resolveOpenClawConfigPath,
  toOpenClawModelRef,
  toOpenClawProviderModel,
} from './utils.mjs';

import {
  buildSyncedOpenClawConfig,
  getSelectedBackendModelId,
  resolveModelHubApiKey,
  upsertModelHubIntoOpenClawConfig,
} from './index.mjs';

describe('openclaw cli helpers', () => {
  it('resolveOpenClawConfigPath honors env precedence', () => {
    expect(resolveOpenClawConfigPath({ OPENCLAW_CONFIG_PATH: '/tmp/custom.json' })).toBe(
      path.resolve('/tmp/custom.json'),
    );
    expect(resolveOpenClawConfigPath({ OPENCLAW_STATE_DIR: '/tmp/state' })).toBe(
      path.join(path.resolve('/tmp/state'), 'openclaw.json'),
    );
  });

  it('maps catalog models to OpenClaw provider models', () => {
    const model = toOpenClawProviderModel({
      capabilities: { images: true, reasoning: 'advanced' },
      contextWindow: 131072,
      name: 'GPT OSS 20B',
      providerId: 'openrouter',
      unifiedModelId: 'openrouter/openai/gpt-oss-20b:free',
    });

    expect(model).toEqual({
      contextWindow: 131072,
      id: 'openrouter/openai/gpt-oss-20b:free',
      input: ['text', 'image'],
      name: 'GPT OSS 20B',
      reasoning: true,
    });
  });

  it('upserts ModelHub provider config with env var by default', () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: {
            fallbacks: ['anthropic/claude-sonnet-4-5'],
            primary: 'anthropic/claude-opus-4-5',
          },
        },
      },
      models: {
        mode: 'merge',
        providers: {
          anthropic: {
            apiKey: '${ANTHROPIC_API_KEY}',
          },
        },
      },
    };

    const nextConfig = upsertModelHubIntoOpenClawConfig(existingConfig, {
      apiKey: 'sk-modelhub',
      catalog: [
        {
          alias: 'GPT OSS 20B Alias',
          capabilities: { images: false, reasoning: 'advanced' },
          contextWindow: 65536,
          name: 'GPT OSS 20B',
          providerId: 'openrouter',
          unifiedModelId: 'openrouter/openai/gpt-oss-20b:free',
        },
      ],
      providerId: 'modelhub',
      selectedModelId: 'openrouter/openai/gpt-oss-20b:free',
      serviceBaseUrl: 'https://modelhub-mu.vercel.app',
      useEnvVar: true,
    });

    expect(nextConfig.models.providers.anthropic).toEqual(existingConfig.models.providers.anthropic);
    expect(nextConfig.models.providers.modelhub.apiKey).toBe('${MODELHUB_API_KEY}');
    expect(nextConfig.models.providers.modelhub.baseUrl).toBe('https://modelhub-mu.vercel.app/v1');
    expect(nextConfig.agents.defaults.model.primary).toBe('modelhub/openrouter/openai/gpt-oss-20b:free');
    expect(nextConfig.agents.defaults.model.fallbacks).toEqual(['anthropic/claude-sonnet-4-5']);
    expect(nextConfig.agents.defaults.models).toEqual({
      'modelhub/openrouter/openai/gpt-oss-20b:free': { alias: 'GPT OSS 20B Alias' },
    });
  });

  it('upserts ModelHub provider config with raw apiKey when useEnvVar is false', () => {
    const nextConfig = upsertModelHubIntoOpenClawConfig({}, {
      apiKey: 'sk-modelhub',
      catalog: [],
      providerId: 'modelhub',
      selectedModelId: 'openai/gpt-4.1',
      serviceBaseUrl: 'https://modelhub-mu.vercel.app',
      useEnvVar: false,
    });

    expect(nextConfig.models.providers.modelhub.apiKey).toBe('sk-modelhub');
  });

  it('derives the backend model id from the OpenClaw primary model ref', () => {
    const config = {
      agents: {
        defaults: {
          model: {
            primary: toOpenClawModelRef('modelhub', 'groq/llama-3.3-70b-versatile'),
          },
        },
      },
    };

    expect(getSelectedBackendModelId(config, 'modelhub')).toBe('groq/llama-3.3-70b-versatile');
  });

  it('builds the OpenAI-compatible provider base URL', () => {
    expect(buildProviderBaseUrl('https://modelhub-mu.vercel.app')).toBe('https://modelhub-mu.vercel.app/v1');
    expect(buildProviderBaseUrl('https://modelhub-mu.vercel.app/v1')).toBe('https://modelhub-mu.vercel.app/v1');
  });

  it('resolves env-backed MODELHUB_API_KEY values for legacy commands', () => {
    const previousApiKey = process.env.MODELHUB_API_KEY;
    const config = {
      models: {
        providers: {
          modelhub: {
            apiKey: '${MODELHUB_API_KEY}',
          },
        },
      },
    };

    try {
      delete process.env.MODELHUB_API_KEY;
      expect(() => resolveModelHubApiKey({}, config, 'modelhub')).toThrow(
        'MODELHUB_API_KEY nao encontrado no ambiente.',
      );

      process.env.MODELHUB_API_KEY = 'sk-env-modelhub';
      const resolved = resolveModelHubApiKey({}, config, 'modelhub');
      expect(resolved.apiKey).toBe('sk-env-modelhub');
      expect(resolved.persistedApiKeyValue).toBe('${MODELHUB_API_KEY}');
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.MODELHUB_API_KEY;
      } else {
        process.env.MODELHUB_API_KEY = previousApiKey;
      }
    }
  });

  it('builds sync config from /openclaw/config without losing model ids or slashes', () => {
    const nextConfig = buildSyncedOpenClawConfig(
      {
        agents: {
          defaults: {
            model: {
              primary: 'modelhub/openai/gpt-4.1-mini',
            },
            models: {
              'anthropic/claude-sonnet-4-5': { alias: 'Claude Sonnet' },
            },
          },
        },
      },
      {
        agents: {
          defaults: {
            model: {
              fallbacks: ['groq/llama-3.3-70b-versatile'],
              primary: 'openrouter/openai/gpt-oss-20b:free',
            },
            models: {
              'openrouter/openai/gpt-oss-20b:free': { alias: 'OpenRouter: GPT OSS 20B' },
            },
          },
        },
        models: {
          mode: 'merge',
          providers: {
            modelhub: {
              api: 'openai-completions',
              apiKey: '${MODELHUB_API_KEY}',
              baseUrl: 'https://www.modelhub.com.br/v1',
              models: [
                {
                  alias: 'OpenRouter: GPT OSS 20B',
                  contextWindow: 131072,
                  id: 'openrouter/openai/gpt-oss-20b:free',
                  input: ['text'],
                  name: 'OpenRouter: GPT OSS 20B',
                  reasoning: true,
                },
                {
                  id: 'groq/llama-3.3-70b-versatile',
                  input: ['text'],
                  name: 'Groq: Llama 3.3 70B',
                  reasoning: false,
                },
              ],
            },
          },
        },
      },
      {
        apiKeyValue: '${MODELHUB_API_KEY}',
        preferredModelId: 'modelhub/openrouter/openai/gpt-oss-20b:free',
        providerId: 'modelhub',
        serviceBaseUrl: 'https://www.modelhub.com.br',
      },
    );

    expect(nextConfig.models.providers.modelhub.models).toEqual([
      {
        contextWindow: 131072,
        id: 'openrouter/openai/gpt-oss-20b:free',
        input: ['text'],
        name: 'OpenRouter: GPT OSS 20B',
        reasoning: true,
      },
      {
        id: 'groq/llama-3.3-70b-versatile',
        input: ['text'],
        name: 'Groq: Llama 3.3 70B',
        reasoning: false,
      },
    ]);
    expect(nextConfig.agents.defaults.model.primary).toBe(
      'modelhub/openrouter/openai/gpt-oss-20b:free',
    );
    expect(nextConfig.agents.defaults.model.fallbacks).toEqual([
      'modelhub/groq/llama-3.3-70b-versatile',
    ]);
    expect(nextConfig.agents.defaults.models).toEqual({
      'anthropic/claude-sonnet-4-5': { alias: 'Claude Sonnet' },
      'modelhub/openrouter/openai/gpt-oss-20b:free': { alias: 'OpenRouter: GPT OSS 20B' },
    });
  });
});
