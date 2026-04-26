# ModelHub OpenClaw CLI

CLI leve para conectar uma instalacao do OpenClaw ao ModelHub sem depender do app Next.js.

## Uso via npx

```bash
npx @model-hub/openclaw-cli run \
  --base-url https://www.modelhub.com.br \
  --api-key SUA_API_KEY
```

## Comandos

```bash
npx @model-hub/openclaw-cli run [--api-key KEY] [--base-url URL] [--bridge-port PORT]
npx @model-hub/openclaw-cli setup [--base-url URL] [--api-key KEY] [--model MODEL]
npx @model-hub/openclaw-cli sync [--base-url URL] [--api-key KEY]
npx @model-hub/openclaw-cli login [--base-url URL] [--api-key KEY]
npx @model-hub/openclaw-cli models [--base-url URL] [--api-key KEY]
npx @model-hub/openclaw-cli use <model-id>
npx @model-hub/openclaw-cli doctor [--base-url URL] [--api-key KEY] [--model MODEL]
```

## O que ele faz

- `run` e o fluxo principal: diagnostica, sincroniza a configuracao e inicia a integracao local
- `bridge` continua disponivel como alias de compatibilidade para `run`
- `setup`, `sync`, `login`, `models`, `use` e `doctor` ficam disponiveis como comandos avancados
- A configuracao real do OpenClaw continua sendo escrita em `~/.openclaw/openclaw.json`
- Clientes novos preferem `GET /openclaw/manifest`; endpoints antigos continuam com fallback por uma release
- Rotas locais mutaveis do bridge exigem `Authorization: Bearer <bridge-token>`

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
