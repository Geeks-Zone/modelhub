import { describe, expect, it } from 'vitest';

import {
  extractConfiguredModels,
  findConfiguredModel,
  normalizeBaseUrl,
  normalizeConfiguredModelRef,
  normalizeServiceBaseUrl,
  sanitizeModelInputTypes,
  sanitizeProviderModels,
  toConfiguredModelRef,
  toOpenClawProviderModel,
} from './utils.mjs';

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

describe('sanitizeModelInputTypes', () => {
  it('keeps only OpenClaw-supported inputs', () => {
    expect(sanitizeModelInputTypes(['text', 'audio', 'image', 'image'])).toEqual(['text', 'image']);
  });

  it('falls back to text when nothing supported remains', () => {
    expect(sanitizeModelInputTypes(['audio', 'video'])).toEqual(['text']);
  });
});

describe('sanitizeProviderModels', () => {
  it('drops unsupported keys and normalizes fields', () => {
    expect(sanitizeProviderModels([
      {
        alias: 'Alias',
        contextWindow: 8192,
        extra: 'ignore',
        id: 'model-1',
        input: ['text', 'audio', 'image'],
        maxTokens: 1024,
        name: 'Model 1',
        reasoning: 'advanced',
      },
      {
        input: ['audio'],
        name: 'Missing id',
      },
    ])).toEqual([
      {
        contextWindow: 8192,
        id: 'model-1',
        input: ['text', 'image'],
        maxTokens: 1024,
        name: 'Model 1',
        reasoning: true,
      },
    ]);
  });

  it('preserves supported OpenClaw compatibility hints', () => {
    expect(sanitizeProviderModels([
      {
        compat: {
          extra: true,
          supportsTools: false,
        },
        id: 'cerebras/llama3.1-8b',
        input: ['text'],
        name: 'Llama 3.1 8B',
      },
    ])).toEqual([
      {
        compat: {
          supportsTools: false,
        },
        id: 'cerebras/llama3.1-8b',
        input: ['text'],
        name: 'Llama 3.1 8B',
        reasoning: false,
      },
    ]);
  });
});

describe('toOpenClawProviderModel', () => {
  it('uses catalog model name directly', () => {
    expect(toOpenClawProviderModel({
      capabilities: {
        images: false,
        reasoning: 'none',
        tools: true,
      },
      name: 'Cerebras: Llama 3.1 8B',
      providerId: 'cerebras',
      unifiedModelId: 'cerebras/llama3.1-8b',
    })).toEqual({
      id: 'cerebras/llama3.1-8b',
      input: ['text'],
      name: 'Cerebras: Llama 3.1 8B',
      reasoning: false,
    });
  });
});

describe('toConfiguredModelRef', () => {
  it('keeps canonical refs stable and prefixes backend ids', () => {
    expect(toConfiguredModelRef('modelhub', 'cerebras/llama3.1-8b')).toBe('modelhub/cerebras/llama3.1-8b');
    expect(toConfiguredModelRef('modelhub', 'modelhub/cerebras/llama3.1-8b')).toBe('modelhub/cerebras/llama3.1-8b');
  });
});

describe('extractConfiguredModels', () => {
  it('exposes canonical OpenClaw refs for configured provider models', () => {
    expect(extractConfiguredModels({
      models: {
        providers: {
          cerebras: {
            models: [{ id: 'llama3.1-8b', name: 'Native Llama' }],
          },
          modelhub: {
            models: [{ id: 'cerebras/llama3.1-8b', name: 'ModelHub Llama' }],
          },
        },
      },
    })).toEqual([
      {
        backendId: 'llama3.1-8b',
        id: 'cerebras/llama3.1-8b',
        input: ['text'],
        name: 'Native Llama',
        providerId: 'cerebras',
        reasoning: false,
      },
      {
        backendId: 'cerebras/llama3.1-8b',
        id: 'modelhub/cerebras/llama3.1-8b',
        input: ['text'],
        name: 'ModelHub Llama',
        providerId: 'modelhub',
        reasoning: false,
      },
    ]);
  });
});

describe('normalizeConfiguredModelRef', () => {
  it('maps legacy backend-only ids to the configured OpenClaw model ref', () => {
    const config = {
      models: {
        providers: {
          modelhub: {
            models: [{ id: 'cerebras/llama3.1-8b', name: 'ModelHub Llama' }],
          },
        },
      },
    };

    expect(normalizeConfiguredModelRef(config, 'cerebras/llama3.1-8b')).toBe('modelhub/cerebras/llama3.1-8b');
    expect(normalizeConfiguredModelRef(config, 'modelhub/cerebras/llama3.1-8b')).toBe('modelhub/cerebras/llama3.1-8b');
  });
});

describe('findConfiguredModel', () => {
  it('finds configured models by canonical ref or backend id', () => {
    const config = {
      models: {
        providers: {
          modelhub: {
            models: [{ id: 'cerebras/llama3.1-8b', name: 'ModelHub Llama' }],
          },
        },
      },
    };

    expect(findConfiguredModel(config, 'cerebras/llama3.1-8b')).toEqual({
      backendId: 'cerebras/llama3.1-8b',
      id: 'modelhub/cerebras/llama3.1-8b',
      input: ['text'],
      name: 'ModelHub Llama',
      providerId: 'modelhub',
      reasoning: false,
    });
    expect(findConfiguredModel(config, 'modelhub/cerebras/llama3.1-8b')?.id).toBe('modelhub/cerebras/llama3.1-8b');
    expect(findConfiguredModel(config, 'gateway/openai/gpt-5-mini')).toBeNull();
  });
});
