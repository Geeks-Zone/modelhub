﻿﻿﻿﻿﻿# ModelHub OpenClaw CLI

CLI leve para conectar uma instalacao do OpenClaw ao ModelHub sem depender do app Next.js.

## Uso via npx

```bash
npx @model-hub/openclaw-cli setup \
  --base-url https://www.modelhub.com.br \
  --api-key SUA_API_KEY
```

## Comandos

```bash
npx @model-hub/openclaw-cli setup [--base-url URL] [--api-key KEY] [--model MODEL]
npx @model-hub/openclaw-cli login [--base-url URL] [--api-key KEY]
npx @model-hub/openclaw-cli models [--base-url URL] [--api-key KEY]
npx @model-hub/openclaw-cli use <model-id>
npx @model-hub/openclaw-cli doctor [--base-url URL] [--api-key KEY] [--model MODEL]
```

## O que ele faz

- Descobre os endpoints `openclaw/*` e `v1/*` do ModelHub
- Sincroniza o catalogo de modelos do tenant
- Escreve a configuracao real do OpenClaw em `~/.openclaw/openclaw.json`
- Configura um provider customizado `modelhub`
- Define o modelo primario no formato `modelhub/<provider/model-id>`

## Arquivo gerado

Exemplo resumido do que o CLI escreve:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "modelhub/openrouter/openai/gpt-oss-20b:free"
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "modelhub": {
        "baseUrl": "https://www.modelhub.com.br/v1",
        "apiKey": "sk-...",
        "api": "openai-completions",
        "models": [
          {
            "id": "openrouter/openai/gpt-oss-20b:free",
            "name": "GPT OSS 20B (openrouter)"
          }
        ]
      }
    }
  }
}
```

