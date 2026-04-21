﻿﻿﻿﻿﻿<p align="right"><a href="README_EN.md">English</a></p>

# ðŸš€ ModelHub

<div align="center">

![ModelHub Logo](https://img.shields.io/badge/ModelHub-AI%20Gateway-blue?style=for-the-badge)

**Hub unificado para mÃºltiplos modelos de IA com API compatÃ­vel OpenAI**

[![CI](https://github.com/Geeks-Zone/modelhub/actions/workflows/ci.yml/badge.svg)](https://github.com/Geeks-Zone/modelhub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black)](https://nextjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Geeks-Zone/modelhub/pulls)
[![GitHub Stars](https://img.shields.io/github/stars/Geeks-Zone/modelhub)](https://github.com/Geeks-Zone/modelhub/stargazers)

[Funcionalidades](#-funcionalidades) â€¢
[Demo](#-demo) â€¢
[InstalaÃ§Ã£o](#-instalaÃ§Ã£o) â€¢
[DocumentaÃ§Ã£o](#-documentaÃ§Ã£o) â€¢
[Contribuir](#-contribuindo) â€¢
[LicenÃ§a](#-licenÃ§a)

</div>

---

## ðŸ“‹ Sobre

ModelHub Ã© uma plataforma open-source que unifica o acesso a mÃºltiplos provedores de IA (OpenAI, Anthropic, Google, Groq, Mistral e outros) atravÃ©s de uma Ãºnica API compatÃ­vel com OpenAI. Inclui interface de chat integrada, gerenciamento seguro de credenciais e sistema de autenticaÃ§Ã£o robusto.

### âœ¨ Funcionalidades

- ðŸ”Œ **API Gateway Unificada** - Interface compatÃ­vel com OpenAI para mÃºltiplos provedores
- ðŸ’¬ **Chat Integrado** - Interface web moderna para interagir com modelos de IA
- ðŸ” **AutenticaÃ§Ã£o Segura** - Sistema completo com Neon Auth
- ðŸ”‘ **Gerenciamento de Credenciais** - Armazenamento criptografado de API keys
- ðŸ“Š **Dashboard de Uso** - Monitore consumo e custos em tempo real
- ðŸ“Ž **Suporte a Anexos** - Upload de imagens, PDFs e documentos
- ðŸŒ **Multi-tenant** - Suporte para mÃºltiplos usuÃ¡rios e organizaÃ§Ãµes
- ðŸš€ **Deploy FÃ¡cil** - Pronto para Vercel, Docker e outras plataformas
- ðŸ“ **TypeScript** - Totalmente tipado para melhor DX
- ðŸ§ª **Testado** - Cobertura de testes com Vitest

### ðŸŽ¯ Provedores Suportados

- OpenAI (GPT-4, GPT-3.5, etc.)
- Anthropic (Claude 3.5, Claude 3, etc.)
- Google AI (Gemini Pro, Gemini Flash)
- Groq (Llama, Mixtral)
- Mistral AI
- Cohere
- HuggingFace
- OpenRouter
- Vercel AI Gateway

## ðŸŽ¬ Demo

> Demo ao vivo: em breve

### Screenshots

| Chat | Dashboard | Configuracoes |
|------|-----------|---------------|
| ![Chat](docs/images/chat-placeholder.png) | ![Dashboard](docs/images/dashboard-placeholder.png) | ![Settings](docs/images/settings-placeholder.png) |

> Para gerar screenshots reais, execute `pnpm dev` e capture as telas da aplicacao.

## ðŸš€ InstalaÃ§Ã£o

### PrÃ©-requisitos

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Conta no [Neon](https://neon.tech) (PostgreSQL serverless)
- API keys dos provedores que deseja usar

### InstalaÃ§Ã£o RÃ¡pida

```bash
# Clone o repositÃ³rio
git clone https://github.com/Geeks-Zone/modelhub.git
cd modelhub

# Instale as dependÃªncias
pnpm install

# Configure as variÃ¡veis de ambiente
cp .env.example .env
# Edite .env com suas credenciais

# Execute as migraÃ§Ãµes do banco de dados
pnpm prisma:migrate

# Inicie o servidor de desenvolvimento
pnpm dev
```

Acesse http://localhost:3000

### ðŸ³ Docker

```bash
# Build da imagem
docker build -t modelhub .

# Execute o container
docker run -p 3000:3000 --env-file .env modelhub
```

### â˜ï¸ Deploy na Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Geeks-Zone/modelhub)

1. Clique no botÃ£o acima
2. Configure as variÃ¡veis de ambiente
3. Deploy!

## ðŸ“– DocumentaÃ§Ã£o

### ConfiguraÃ§Ã£o

#### VariÃ¡veis de Ambiente

Veja [.env.example](.env.example) para todas as opÃ§Ãµes disponÃ­veis.

**ObrigatÃ³rias:**
```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
NEON_AUTH_BASE_URL="https://..."
NEON_AUTH_COOKIE_SECRET="..."
ENCRYPTION_KEY="..."
```

**Opcionais:**
```env
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GOOGLE_AI_STUDIO_API_KEY="..."
```

#### Banco de Dados

O projeto usa Prisma com PostgreSQL (Neon):

```bash
# Gerar cliente Prisma
pnpm prisma:generate

# Executar migraÃ§Ãµes
pnpm prisma:migrate

# Push schema (desenvolvimento)
pnpm prisma:push
```

### Uso da API

#### Endpoint de Chat

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "openrouter/openai/gpt-oss-20b:free",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

#### Listar Modelos

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### OpenClaw (modo OpenAI-compatible)

ConfiguraÃ§Ã£o mÃ­nima no OpenClaw:

- **Base URL:** `https://www.modelhub.com.br/v1`
- **API:** OpenAI-compatible chat completions
- **Auth:** `Authorization: Bearer <MODELHUB_API_KEY>`
- **Modelo:** use IDs no formato `provider/model-id` (ex.: `openrouter/openai/gpt-oss-20b:free`)

Presets recomendados:

- **Coding:** modelos com reasoning/tool-use (ex.: famÃ­lia GPT OSS, Qwen Coder, Sonnet)
- **Low cost:** modelos `:free`, `mini` e `flash`
- **Long context:** modelos `128k+` / `long context`

Troubleshooting rÃ¡pido:

- **401/403 auth:** valide API key e header Bearer
- **modelo invÃ¡lido:** primeiro consulte `GET /v1/models` e use exatamente o `id` retornado
- **timeout/latÃªncia:** troque para preset low-cost/flash e reduza `max_tokens`

### OpenClaw (setup real no `openclaw.json` via `npx`)

O caminho recomendado agora e usar o CLI dedicado do OpenClaw/ModelHub via `npx`. Ele:

- consulta `GET /openclaw/discovery` e `GET /openclaw/catalog`
- sincroniza o catalogo do tenant no OpenClaw
- grava a configuracao real em `~/.openclaw/openclaw.json`
- cria um provider customizado `modelhub`
- define o modelo primario no formato `modelhub/<provider/model-id>`

```bash
# Bootstrap completo do OpenClaw apontando para a instancia publica
npx @model-hub/openclaw-cli setup \
  --base-url https://www.modelhub.com.br \
  --api-key SUA_API_KEY

# Validar integracao ponta a ponta
npx @model-hub/openclaw-cli doctor

# Listar os modelos sincronizados para o OpenClaw
npx @model-hub/openclaw-cli models

# Trocar o modelo primario dentro do openclaw.json
npx @model-hub/openclaw-cli use groq/llama-3.3-70b-versatile
```

Estrutura gerada no OpenClaw:

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
        "api": "openai-completions"
      }
    }
  }
}
```

### OpenClaw (wrapper legado do repositÃ³rio)

```bash
# O wrapper local continua disponivel para desenvolvimento
modelhub openclaw setup --base-url https://www.modelhub.com.br --api-key SUA_API_KEY

# Reautenticar e atualizar o catalogo
modelhub openclaw login --base-url https://www.modelhub.com.br --api-key SUA_API_KEY

# Listar modelos disponiveis para o provider customizado do OpenClaw
modelhub openclaw models

# Definir modelo primario no openclaw.json
modelhub openclaw use openrouter/openai/gpt-oss-20b:free

# Diagnostico de integracao
modelhub doctor
```

### Desenvolvimento

```bash
# Desenvolvimento
pnpm dev

# Build
pnpm build

# Testes
pnpm test

# Lint
pnpm lint

# Type check
pnpm typecheck
```

## ðŸ—ï¸ Arquitetura

```
modelhub/
â”œâ”€â”€ app/                    # Next.js App Router
â”‚   â”œâ”€â”€ (app)/             # Rotas autenticadas
â”‚   â”œâ”€â”€ api/               # API routes
â”‚   â””â”€â”€ auth/              # AutenticaÃ§Ã£o
â”œâ”€â”€ components/            # Componentes React
â”‚   â”œâ”€â”€ chat/             # Interface de chat
â”‚   â”œâ”€â”€ dashboard/        # Dashboard
â”‚   â””â”€â”€ ui/               # Componentes UI (shadcn)
â”œâ”€â”€ lib/                   # UtilitÃ¡rios e lÃ³gica
â”‚   â”œâ”€â”€ auth/             # AutenticaÃ§Ã£o
â”‚   â””â”€â”€ chat-stream.ts    # Streaming de chat
â”œâ”€â”€ prisma/               # Schema e migraÃ§Ãµes
â”œâ”€â”€ server/               # LÃ³gica do servidor (Hono)
â””â”€â”€ scripts/              # Scripts de build e deploy
```

## ðŸ¤ Contribuindo

ContribuiÃ§Ãµes sÃ£o muito bem-vindas! Veja [CONTRIBUTING.md](CONTRIBUTING.md) para detalhes.

### Como Contribuir

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanÃ§as (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

### CÃ³digo de Conduta

Este projeto adota o [Contributor Covenant](CODE_OF_CONDUCT.md). Ao participar, vocÃª concorda em seguir seus termos.

## ðŸ› Reportar Bugs

Encontrou um bug? Por favor, abra uma [issue](https://github.com/Geeks-Zone/modelhub/issues) com:

- DescriÃ§Ã£o clara do problema
- Passos para reproduzir
- Comportamento esperado vs atual
- Screenshots (se aplicÃ¡vel)
- Ambiente (OS, Node version, etc.)

## ðŸ”’ SeguranÃ§a

Para reportar vulnerabilidades de seguranÃ§a, veja [SECURITY.md](SECURITY.md).

## ðŸ“ LicenÃ§a

Este projeto estÃ¡ licenciado sob a LicenÃ§a MIT - veja [LICENSE](LICENSE) para detalhes.

## ðŸ™ Agradecimentos

- [Next.js](https://nextjs.org/) - Framework React
- [Prisma](https://www.prisma.io/) - ORM
- [Neon](https://neon.tech/) - PostgreSQL Serverless
- [shadcn/ui](https://ui.shadcn.com/) - Componentes UI
- [Hono](https://hono.dev/) - Framework web
- Todos os [contribuidores](https://github.com/Geeks-Zone/modelhub/graphs/contributors)

## ðŸ“ž Suporte

- ðŸ“§ Email: support@modelhub.dev
- ðŸ’¬ Discord: [Join our community](https://discord.gg/modelhub)
- ðŸ¦ Twitter: [@modelhub](https://twitter.com/modelhub)
- ðŸ“– Docs: [docs.modelhub.dev](https://docs.modelhub.dev)

## ðŸ—ºï¸ Roadmap

- [ ] Suporte a mais provedores (Perplexity, Together AI)
- [ ] Sistema de plugins
- [ ] AnÃ¡lise de custos avanÃ§ada
- [ ] Suporte a embeddings
- [ ] API de fine-tuning
- [ ] Mobile app
- [ ] IntegraÃ§Ã£o com Langchain/LlamaIndex

---

<div align="center">

**[â¬† Voltar ao topo](#-modelhub)**

Feito com â¤ï¸ pela comunidade ModelHub

</div>

