# ðŸ“¡ DocumentaÃ§Ã£o da API

API compatÃ­vel com OpenAI para acesso unificado a mÃºltiplos provedores de IA.

## ðŸ”‘ AutenticaÃ§Ã£o

Todas as requisiÃ§Ãµes requerem autenticaÃ§Ã£o via Bearer token:

```bash
Authorization: Bearer YOUR_API_KEY
```

### Obter API Key

1. FaÃ§a login em https://www.modelhub.com.br
2. VÃ¡ para Settings â†’ API Keys
3. Clique em "Create New Key"
4. Copie e guarde sua chave (nÃ£o serÃ¡ mostrada novamente)

## ðŸ“‹ Base URL

```
https://www.modelhub.com.br/v1
```

> Para endpoints de discovery/onboarding OpenClaw, use `https://www.modelhub.com.br/openclaw/*`.

## ðŸš€ Endpoints

### Chat Completions

Cria uma completion de chat.

**Endpoint:** `POST /v1/chat/completions`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

**Body:**
```json
{
  "model": "openrouter/openai/gpt-oss-20b:free",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

**ParÃ¢metros:**

| Campo | Tipo | ObrigatÃ³rio | DescriÃ§Ã£o |
|-------|------|-------------|-----------|
| `model` | string | Sim | ID no formato `provider/model-id` (ex: `groq/llama-3.3-70b-versatile`) |
| `messages` | array | Sim | Array de mensagens |
| `temperature` | number | NÃ£o | 0-2, padrÃ£o 1 |
| `max_tokens` | number | NÃ£o | MÃ¡ximo de tokens na resposta |
| `stream` | boolean | NÃ£o | Se true, retorna stream SSE |
| `top_p` | number | NÃ£o | 0-1, padrÃ£o 1 |
| `frequency_penalty` | number | NÃ£o | -2 a 2, padrÃ£o 0 |
| `presence_penalty` | number | NÃ£o | -2 a 2, padrÃ£o 0 |

**Resposta (nÃ£o-stream):**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

**Resposta (stream):**
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Listar Modelos

Lista todos os modelos disponÃ­veis.

**Endpoint:** `GET /v1/models`

**Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Resposta:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4",
      "object": "model",
      "created": 1677610602,
      "owned_by": "openai",
      "provider": "openai"
    },
    {
      "id": "claude-3-5-sonnet-20241022",
      "object": "model",
      "created": 1677610602,
      "owned_by": "anthropic",
      "provider": "anthropic"
    }
  ]
}
```

### Obter Modelo

ObtÃ©m informaÃ§Ãµes sobre um modelo especÃ­fico.

**Endpoint:** `GET /v1/models/{model_id}`

**Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Resposta:**
```json
{
  "id": "gpt-4",
  "object": "model",
  "created": 1677610602,
  "owned_by": "openai",
  "provider": "openai",
  "capabilities": {
    "chat": true,
    "completion": true,
    "vision": true
  }
}
```

### OpenClaw Discovery

Metadados para onboarding de provider de primeira classe.

**Endpoint:** `GET /openclaw/discovery`

**Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Resposta (resumo):**
```json
{
  "provider": { "id": "modelhub", "name": "ModelHub" },
  "api": {
    "chatCompletions": "https://www.modelhub.com.br/v1/chat/completions",
    "models": "https://www.modelhub.com.br/v1/models",
    "catalog": "https://www.modelhub.com.br/openclaw/catalog",
    "health": "https://www.modelhub.com.br/openclaw/health",
    "status": "https://www.modelhub.com.br/openclaw/status"
  },
  "auth": {
    "methods": ["api_key", "session_cookie"]
  },
  "onboarding": {
    "headless": true,
    "presets": [
      { "preset": "coding", "model": "openrouter/openai/gpt-oss-20b:free" }
    ]
  }
}
```

### OpenClaw Catalog

CatÃ¡logo dinÃ¢mico de modelos por tenant/workspace com metadados operacionais.

**Endpoint:** `GET /openclaw/catalog`

### OpenClaw Status

Status de autenticaÃ§Ã£o e permissÃµes de uso.

**Endpoint:** `GET /openclaw/status`

### OpenClaw Health

Health probe para diagnÃ³stico de integraÃ§Ã£o OpenClaw.

**Endpoint:** `GET /openclaw/health`

## ðŸ”Œ Provedores Suportados

### OpenAI

**Modelos:**
- `gpt-4-turbo`
- `gpt-4`
- `gpt-3.5-turbo`

**Formato do modelo:** `gpt-4`

### Anthropic

**Modelos:**
- `claude-3-5-sonnet-20241022`
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`

**Formato do modelo:** `claude-3-5-sonnet-20241022`

### Google AI

**Modelos:**
- `gemini-2.0-flash-exp`
- `gemini-1.5-pro`
- `gemini-1.5-flash`

**Formato do modelo:** `gemini-2.0-flash-exp`

### Groq

**Modelos:**
- `llama-3.3-70b-versatile`
- `mixtral-8x7b-32768`

**Formato do modelo:** `llama-3.3-70b-versatile`

## ðŸ’¡ Exemplos

### cURL

```bash
curl https://www.modelhub.com.br/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "openrouter/openai/gpt-oss-20b:free",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://www.modelhub.com.br/v1"
)

response = client.chat.completions.create(
    model="openrouter/openai/gpt-oss-20b:free",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

### JavaScript/TypeScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://www.modelhub.com.br/v1'
});

const response = await client.chat.completions.create({
  model: 'openrouter/openai/gpt-oss-20b:free',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);
```

### Streaming

```typescript
const stream = await client.chat.completions.create({
  model: 'openrouter/openai/gpt-oss-20b:free',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true
});

### Bootstrap OpenClaw com CLI

```bash
npx @model-hub/openclaw-cli setup \
  --base-url https://www.modelhub.com.br \
  --api-key YOUR_API_KEY

npx @model-hub/openclaw-cli models
npx @model-hub/openclaw-cli doctor
```

Esse CLI escreve a configuracao real do OpenClaw em `~/.openclaw/openclaw.json`, criando:

- provider customizado `modelhub`
- `baseUrl` apontando para `https://www.modelhub.com.br/v1`
- `api: openai-completions`
- modelo primario em `agents.defaults.model.primary` no formato `modelhub/<provider/model-id>`

Wrapper legado local:

```bash
modelhub openclaw setup --base-url https://www.modelhub.com.br --api-key YOUR_API_KEY
modelhub openclaw models
modelhub doctor
```

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}
```

## âš ï¸ CÃ³digos de Erro

| CÃ³digo | DescriÃ§Ã£o |
|--------|-----------|
| 400 | Bad Request - ParÃ¢metros invÃ¡lidos |
| 401 | Unauthorized - API key invÃ¡lida ou ausente |
| 403 | Forbidden - Sem permissÃ£o para acessar recurso |
| 404 | Not Found - Recurso nÃ£o encontrado |
| 429 | Too Many Requests - Rate limit excedido |
| 500 | Internal Server Error - Erro no servidor |
| 502 | Bad Gateway - Erro no provedor upstream |
| 503 | Service Unavailable - ServiÃ§o temporariamente indisponÃ­vel |

**Formato de Erro:**
```json
{
  "error": {
    "message": "Invalid API key",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

## ðŸš¦ Rate Limiting

- **Limite padrÃ£o:** 100 requisiÃ§Ãµes por minuto
- **Headers de resposta:**
  - `X-RateLimit-Limit`: Limite total
  - `X-RateLimit-Remaining`: RequisiÃ§Ãµes restantes
  - `X-RateLimit-Reset`: Timestamp de reset

## ðŸ“Š Uso e Custos

Monitore seu uso em:
- Dashboard: https://www.modelhub.com.br/dashboard
- API: `GET /v1/usage`

## ðŸ”’ SeguranÃ§a

- Use HTTPS sempre
- Nunca exponha sua API key
- Rotacione keys regularmente
- Use variÃ¡veis de ambiente

## ðŸ“š SDKs CompatÃ­veis

Como a API Ã© compatÃ­vel com OpenAI, vocÃª pode usar qualquer SDK OpenAI:

- [OpenAI Python](https://github.com/openai/openai-python)
- [OpenAI Node.js](https://github.com/openai/openai-node)
- [OpenAI Go](https://github.com/sashabaranov/go-openai)
- [OpenAI Java](https://github.com/TheoKanning/openai-java)

## ðŸ†˜ Suporte

- DocumentaÃ§Ã£o: https://docs.modelhub.dev
- Issues: https://github.com/Geeks-Zone/modelhub/issues
- Email: api@modelhub.dev

---

**VersÃ£o da API:** v1  
**Ãšltima atualizaÃ§Ã£o:** 2026-04-13

