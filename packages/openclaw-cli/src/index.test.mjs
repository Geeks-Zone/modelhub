import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildProviderBaseUrl,
  getSelectedBackendModelId,
  resolveOpenClawConfigPath,
  toOpenClawModelRef,
  toOpenClawProviderModel,
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
      name: 'GPT OSS 20B (openrouter)',
      reasoning: true,
    });
  });

  it('upserts ModelHub provider config and preserves unrelated config', () => {
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
    });

    expect(nextConfig.models.providers.anthropic).toEqual(existingConfig.models.providers.anthropic);
    expect(nextConfig.models.providers.modelhub).toEqual({
      api: 'openai-completions',
      apiKey: 'sk-modelhub',
      baseUrl: 'https://modelhub-mu.vercel.app/v1',
      models: [
        {
          contextWindow: 65536,
          id: 'openrouter/openai/gpt-oss-20b:free',
          input: ['text'],
          name: 'GPT OSS 20B (openrouter)',
          reasoning: true,
        },
      ],
    });
    expect(nextConfig.agents.defaults.model.primary).toBe('modelhub/openrouter/openai/gpt-oss-20b:free');
    expect(nextConfig.agents.defaults.model.fallbacks).toEqual(['anthropic/claude-sonnet-4-5']);
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
});
