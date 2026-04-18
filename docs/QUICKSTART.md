# âš¡ Guia de InÃ­cio RÃ¡pido

Comece a usar o ModelHub em menos de 5 minutos!

## ðŸŽ¯ PrÃ©-requisitos

Antes de comeÃ§ar, certifique-se de ter:

- âœ… Node.js >= 22.0.0 ([Download](https://nodejs.org))
- âœ… pnpm >= 10.0.0 (`npm install -g pnpm`)
- âœ… Git ([Download](https://git-scm.com))
- âœ… Conta no [Neon](https://neon.tech) (gratuita)

## ðŸš€ InstalaÃ§Ã£o em 3 Passos

### 1ï¸âƒ£ Clone e Instale

```bash
# Clone o repositÃ³rio
git clone https://github.com/Geeks-Zone/modelhub.git
cd modelhub

# Instale as dependÃªncias
pnpm install
```

### 2ï¸âƒ£ Configure o Banco de Dados

**a) Crie um projeto no Neon:**
1. Acesse [console.neon.tech](https://console.neon.tech)
2. Clique em "Create Project"
3. Escolha um nome e regiÃ£o
4. Copie as connection strings

**b) Configure as variÃ¡veis de ambiente:**

```bash
# Copie o arquivo de exemplo
cp .env.example .env

# Edite o arquivo .env
nano .env  # ou use seu editor favorito
```

**VariÃ¡veis obrigatÃ³rias:**
```env
# Cole suas connection strings do Neon
DATABASE_URL="postgresql://user:pass@host-pooler.region.aws.neon.tech/dbname?sslmode=require"
DIRECT_URL="postgresql://user:pass@host.region.aws.neon.tech/dbname?sslmode=require"

# Configure Neon Auth (veja docs do Neon)
NEON_AUTH_BASE_URL="https://your-project.neonauth.region.aws.neon.tech/dbname/auth"

# Gere um secret aleatÃ³rio (32+ caracteres)
NEON_AUTH_COOKIE_SECRET="seu-secret-aleatorio-aqui"

# Gere uma chave de criptografia
ENCRYPTION_KEY="sua-chave-64-caracteres-hex-aqui"
```

**Gerar chaves:**
```bash
# NEON_AUTH_COOKIE_SECRET (32+ caracteres)
openssl rand -base64 32

# ENCRYPTION_KEY (64 caracteres hex)
openssl rand -hex 32
```

**c) Execute as migraÃ§Ãµes:**

```bash
pnpm prisma:migrate
```

### 3ï¸âƒ£ Inicie o Servidor

```bash
# Modo desenvolvimento
pnpm dev
```

Acesse: http://localhost:3000 ðŸŽ‰

## ðŸŽ¨ Primeiro Uso

### 1. Criar Conta

1. Acesse http://localhost:3000
2. Clique em "Sign Up"
3. Preencha email e senha
4. FaÃ§a login

### 2. Adicionar Credenciais

1. VÃ¡ para **Settings** (âš™ï¸)
2. Clique em **Credentials**
3. Selecione um provedor (ex: OpenAI)
4. Cole sua API key
5. Clique em **Save**

**Onde obter API keys:**
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Anthropic: [console.anthropic.com](https://console.anthropic.com)
- Google: [makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey)
- Groq: [console.groq.com/keys](https://console.groq.com/keys)

### 3. ComeÃ§ar a Conversar

1. VÃ¡ para **Chat** (ðŸ’¬)
2. Selecione um modelo
3. Digite sua mensagem
4. Pressione Enter ou clique em Enviar

Pronto! VocÃª estÃ¡ usando o ModelHub! ðŸš€

## ðŸ”Œ Usar a API

### 1. Criar API Key

1. VÃ¡ para **Settings** â†’ **API Keys**
2. Clique em **Create New Key**
3. DÃª um nome (ex: "Meu App")
4. Copie a key (nÃ£o serÃ¡ mostrada novamente!)

### 2. Fazer Primeira RequisiÃ§Ã£o

**cURL:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUA_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "OlÃ¡!"}
    ]
  }'
```

**Python:**
```python
from openai import OpenAI

client = OpenAI(
    api_key="SUA_API_KEY",
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "OlÃ¡!"}]
)

print(response.choices[0].message.content)
```

**JavaScript:**
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'SUA_API_KEY',
  baseURL: 'http://localhost:3000/v1'
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'OlÃ¡!' }]
});

console.log(response.choices[0].message.content);
```

## ðŸ¾ OpenClaw em poucos passos

### ConfiguraÃ§Ã£o mÃ­nima (OpenAI-compatible)

No OpenClaw, configure:

- Base URL: `http://localhost:3000/v1`
- Auth: `Bearer SUA_API_KEY`
- Modelo: valor retornado por `GET /v1/models` no formato `provider/model-id`

### Setup real do OpenClaw com `npx`

```bash
# Bootstrap guiado (discovery + catalogo + escrita no ~/.openclaw/openclaw.json)
npx @model-hub/openclaw-cli setup \
  --base-url https://www.modelhub.com.br \
  --api-key SUA_API_KEY

# Trocar o modelo primario depois
npx @model-hub/openclaw-cli use openrouter/openai/gpt-oss-20b:free

# Diagnostico completo de integracao
npx @model-hub/openclaw-cli doctor
```

O CLI cria um provider `modelhub` no OpenClaw com:

- `baseUrl`: `https://www.modelhub.com.br/v1`
- `api`: `openai-completions`
- `model.primary`: `modelhub/<provider/model-id>`

### Wrapper legado do repositÃ³rio

```bash
modelhub openclaw setup --base-url https://www.modelhub.com.br --api-key SUA_API_KEY
modelhub openclaw use openrouter/openai/gpt-oss-20b:free
modelhub doctor
```

### Presets recomendados

- Coding: modelos com melhor reasoning/tool-use
- Low cost: modelos `:free`, `mini`, `flash`
- Long context: modelos com contexto estendido (`128k+`)

## ðŸŽ¯ PrÃ³ximos Passos

### Explore as Features

- ðŸ“Ž **Anexos**: Envie imagens e documentos no chat
- ðŸ“Š **Dashboard**: Monitore uso e custos
- ðŸ”„ **Streaming**: Respostas em tempo real
- ðŸ”— **Compartilhar**: Compartilhe conversas com outros

### Aprenda Mais

- ðŸ“– [DocumentaÃ§Ã£o Completa](../README.md)
- ðŸ”Œ [Guia da API](API.md)
- ðŸ’¡ [Exemplos](EXAMPLES.md)
- â“ [FAQ](FAQ.md)

### Deploy em ProduÃ§Ã£o

- â˜ï¸ [Deploy na Vercel](DEPLOYMENT.md#vercel-recomendado)
- ðŸ³ [Deploy com Docker](DEPLOYMENT.md#docker)
- ðŸ–¥ï¸ [Deploy em VPS](DEPLOYMENT.md#vpscloud)

## ðŸ†˜ Problemas Comuns

### Erro: "Cannot connect to database"

**SoluÃ§Ã£o:**
1. Verifique se `DATABASE_URL` e `DIRECT_URL` estÃ£o corretas
2. Teste a conexÃ£o: `pnpm prisma db pull`
3. Verifique se o banco estÃ¡ acessÃ­vel

### Erro: "Invalid API key"

**SoluÃ§Ã£o:**
1. Verifique se copiou a key completa
2. Verifique se a key nÃ£o expirou
3. Teste a key diretamente no site do provedor

### Erro: "Invalid model" no OpenClaw

**SoluÃ§Ã£o:**
1. FaÃ§a `npx @model-hub/openclaw-cli models`
2. Copie o `model-id` exatamente como retornado depois de `modelhub/`
3. Rode `npx @model-hub/openclaw-cli use <model-id>`

### Erro: timeout no OpenClaw

**SoluÃ§Ã£o:**
1. Rode `npx @model-hub/openclaw-cli doctor` para validar health/status/catalogo
2. Troque para preset low-cost/flash
3. Reduza `max_tokens` no cliente

### Erro: "Port 3000 already in use"

**SoluÃ§Ã£o:**
```bash
# Encontre o processo
lsof -i :3000

# Mate o processo
kill -9 PID

# Ou use outra porta
PORT=3001 pnpm dev
```

### Build falha

**SoluÃ§Ã£o:**
```bash
# Limpe tudo
rm -rf .next node_modules

# Reinstale
pnpm install

# Tente novamente
pnpm build
```

## ðŸ’¡ Dicas

### Performance

- Use **Groq** para respostas ultra-rÃ¡pidas
- Use **GPT-3.5** para economia
- Use **streaming** para melhor UX

### SeguranÃ§a

- Nunca commite arquivos `.env`
- Use HTTPS em produÃ§Ã£o
- Rotacione API keys regularmente
- Configure rate limiting

### Desenvolvimento

- Use `pnpm dev` para hot reload
- Use `pnpm lint` antes de commitar
- Use `pnpm test` para rodar testes
- Use `pnpm typecheck` para verificar tipos

## ðŸŽ“ Tutoriais

### Tutorial 1: Chatbot Simples

```python
from openai import OpenAI

client = OpenAI(
    api_key="SUA_API_KEY",
    base_url="http://localhost:3000/v1"
)

def chat(message, history=[]):
    history.append({"role": "user", "content": message})
    
    response = client.chat.completions.create(
        model="gpt-4",
        messages=history
    )
    
    assistant_message = response.choices[0].message.content
    history.append({"role": "assistant", "content": assistant_message})
    
    return assistant_message, history

# Uso
history = []
response, history = chat("OlÃ¡!", history)
print(response)

response, history = chat("Como vocÃª estÃ¡?", history)
print(response)
```

### Tutorial 2: Comparar Modelos

```python
models = ["gpt-4", "claude-3-5-sonnet-20241022", "gemini-2.0-flash-exp"]
prompt = "Explique IA em uma frase."

for model in models:
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )
    print(f"{model}: {response.choices[0].message.content}")
```

### Tutorial 3: Streaming

```python
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Conte uma histÃ³ria"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

## ðŸ“š Recursos

- [DocumentaÃ§Ã£o](../README.md)
- [API Reference](API.md)
- [Examples](EXAMPLES.md)
- [FAQ](FAQ.md)
- [Discord](https://discord.gg/modelhub)

## ðŸ¤ Precisa de Ajuda?

- ðŸ’¬ [Discord Community](https://discord.gg/modelhub)
- ðŸ› [Report Issues](https://github.com/Geeks-Zone/modelhub/issues)
- ðŸ’¡ [Discussions](https://github.com/Geeks-Zone/modelhub/discussions)
- ðŸ“§ [Email](mailto:support@modelhub.dev)

---

**Pronto para comeÃ§ar?** ðŸš€

```bash
git clone https://github.com/Geeks-Zone/modelhub.git
cd modelhub
pnpm install
cp .env.example .env
# Configure .env
pnpm prisma:migrate
pnpm dev
```

**Divirta-se construindo com IA! ðŸŽ‰**

