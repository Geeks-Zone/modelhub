# 🏗️ Arquitetura do ModelHub

Este documento descreve a arquitetura técnica do ModelHub.

## 📋 Índice

- [Visão Geral](#visão-geral)
- [Estrutura de Diretórios](#estrutura-de-diretórios)
- [Camadas da Aplicação](#camadas-da-aplicação)
- [Fluxo de Dados](#fluxo-de-dados)
- [Componentes Principais](#componentes-principais)
- [Banco de Dados](#banco-de-dados)
- [Autenticação](#autenticação)
- [API Gateway](#api-gateway)

## 🎯 Visão Geral

ModelHub é construído com uma arquitetura moderna de full-stack usando:

- **Frontend**: Next.js 16 (App Router) + React 19
- **Backend**: Next.js API Routes + Hono
- **Database**: PostgreSQL (Neon) + Prisma ORM
- **Auth**: Neon Auth
- **Styling**: Tailwind CSS 4 + shadcn/ui

```
┌─────────────────────────────────────────────────────────┐
│                     Client (Browser)                     │
│                  React 19 + Next.js 16                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ HTTP/WebSocket
                     │
┌────────────────────▼────────────────────────────────────┐
│                   Next.js App Router                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Pages      │  │  API Routes  │  │  Middleware  │  │
│  │ (app/*.tsx)  │  │ (app/api/*)  │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     │
┌────────────────────▼────────────────────────────────────┐
│                    Server Layer (Hono)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Gateway    │  │     Auth     │  │   Business   │  │
│  │   Proxy      │  │   Handler    │  │    Logic     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     │
┌────────────────────▼────────────────────────────────────┐
│                  Data Layer (Prisma)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Models     │  │  Migrations  │  │    Client    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     │
┌────────────────────▼────────────────────────────────────┐
│              PostgreSQL (Neon Serverless)                │
└──────────────────────────────────────────────────────────┘
```

## 📁 Estrutura de Diretórios

```
modelhub/
├── app/                      # Next.js App Router
│   ├── (app)/               # Rotas autenticadas
│   │   ├── chat/           # Interface de chat
│   │   ├── dashboard/      # Dashboard de uso
│   │   └── setup/          # Configuração inicial
│   ├── api/                # API Routes
│   │   ├── auth/          # Endpoints de autenticação
│   │   └── v1/            # API v1 (OpenAI compatible)
│   ├── auth/              # Páginas de autenticação
│   └── share/             # Compartilhamento de conversas
│
├── components/              # Componentes React
│   ├── chat/              # Componentes de chat
│   ├── dashboard/         # Componentes de dashboard
│   ├── landing/           # Landing page
│   └── ui/                # Componentes UI (shadcn)
│
├── lib/                    # Utilitários e lógica
│   ├── auth/             # Autenticação
│   ├── chat-stream.ts    # Streaming de chat
│   ├── provider-credentials.ts  # Gerenciamento de credenciais
│   └── utils.ts          # Utilitários gerais
│
├── server/                 # Lógica do servidor (Hono)
│   ├── gateway/          # Gateway para provedores
│   ├── middleware/       # Middlewares
│   └── routes/           # Rotas do servidor
│
├── prisma/                # Prisma ORM
│   ├── schema.prisma     # Schema do banco
│   └── migrations/       # Migrações
│
├── hooks/                 # React hooks customizados
├── public/               # Arquivos estáticos
└── scripts/              # Scripts de build/deploy
```

## 🔄 Camadas da Aplicação

### 1. Camada de Apresentação (Frontend)

**Responsabilidades:**
- Renderizar UI
- Gerenciar estado local
- Interagir com APIs
- Validar inputs do usuário

**Tecnologias:**
- React 19 (Server & Client Components)
- Next.js 16 (App Router)
- Tailwind CSS 4
- shadcn/ui

**Componentes Principais:**
```typescript
// Server Component (padrão)
export default async function ChatPage() {
  const session = await getSession();
  return <ChatInterface user={session.user} />;
}

// Client Component (quando necessário)
'use client';
export function ChatInput() {
  const [message, setMessage] = useState('');
  // ...
}
```

### 2. Camada de API (Backend)

**Responsabilidades:**
- Processar requisições HTTP
- Validar dados
- Autenticar/autorizar
- Orquestrar lógica de negócio

**Tecnologias:**
- Next.js API Routes
- Hono (framework web)
- Zod (validação)

**Estrutura:**
```typescript
// app/api/v1/chat/completions/route.ts
export async function POST(req: Request) {
  const session = await getSession();
  const body = await req.json();
  
  // Validação
  const validated = chatSchema.parse(body);
  
  // Lógica de negócio
  const response = await processChat(validated);
  
  return Response.json(response);
}
```

### 3. Camada de Negócio (Business Logic)

**Responsabilidades:**
- Implementar regras de negócio
- Gerenciar fluxos complexos
- Integrar com provedores externos
- Processar dados

**Localização:**
- `lib/` - Utilitários e lógica compartilhada
- `server/` - Lógica do servidor

**Exemplo:**
```typescript
// lib/chat-stream.ts
export async function streamChatCompletion(
  provider: string,
  messages: Message[],
  credentials: Credentials
) {
  // Lógica de streaming
  const stream = await providerGateway.stream({
    provider,
    messages,
    credentials
  });
  
  return stream;
}
```

### 4. Camada de Dados (Data Layer)

**Responsabilidades:**
- Persistir dados
- Consultar dados
- Gerenciar transações
- Manter integridade

**Tecnologias:**
- Prisma ORM
- PostgreSQL (Neon)

**Exemplo:**
```typescript
// lib/api.ts
export async function createConversation(
  userId: string,
  title: string
) {
  return await prisma.conversation.create({
    data: {
      userId,
      title,
      createdAt: new Date()
    }
  });
}
```

## 🔄 Fluxo de Dados

### Fluxo de Chat

```
1. Usuário envia mensagem
   ↓
2. ChatInput (Client Component)
   ↓
3. POST /api/v1/chat/completions
   ↓
4. Validação + Autenticação
   ↓
5. Buscar credenciais do usuário (Prisma)
   ↓
6. Gateway seleciona provedor
   ↓
7. Proxy para API do provedor (OpenAI, Anthropic, etc.)
   ↓
8. Stream de resposta
   ↓
9. Salvar mensagem no banco
   ↓
10. Retornar stream para cliente
    ↓
11. Renderizar resposta em tempo real
```

### Fluxo de Autenticação

```
1. Usuário acessa /auth/login
   ↓
2. Formulário de login
   ↓
3. POST /api/auth/login
   ↓
4. Neon Auth valida credenciais
   ↓
5. Gerar JWT token
   ↓
6. Setar cookie httpOnly
   ↓
7. Redirect para /chat
   ↓
8. Middleware valida token
   ↓
9. Carregar dados do usuário
   ↓
10. Renderizar página autenticada
```

## 🧩 Componentes Principais

### 1. API Gateway

**Localização:** `server/gateway/`

**Função:** Proxy unificado para múltiplos provedores de IA

```typescript
interface GatewayRequest {
  provider: string;
  model: string;
  messages: Message[];
  stream?: boolean;
}

class ProviderGateway {
  async route(request: GatewayRequest) {
    const provider = this.getProvider(request.provider);
    return await provider.complete(request);
  }
}
```

### 2. Chat Stream

**Localização:** `lib/chat-stream.ts`

**Função:** Gerenciar streaming de respostas

```typescript
export async function* streamChat(
  provider: Provider,
  messages: Message[]
) {
  const stream = await provider.stream(messages);
  
  for await (const chunk of stream) {
    yield {
      id: generateId(),
      content: chunk.content,
      role: 'assistant'
    };
  }
}
```

### 3. Credential Manager

**Localização:** `lib/provider-credentials.ts`

**Função:** Gerenciar credenciais criptografadas

```typescript
export async function getCredentials(
  userId: string,
  provider: string
) {
  const encrypted = await prisma.providerCredential.findFirst({
    where: { userId, provider }
  });
  
  return decrypt(encrypted.apiKey);
}
```

## 🗄️ Banco de Dados

### Schema Principal

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  conversations Conversation[]
  credentials   ProviderCredential[]
  apiKeys       ApiKey[]
}

model Conversation {
  id        String    @id @default(cuid())
  title     String
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  messages  Message[]
  createdAt DateTime  @default(now())
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  role           String
  content        String       @db.Text
  createdAt      DateTime     @default(now())
}

model ProviderCredential {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  provider  String
  apiKey    String   // Encrypted
  createdAt DateTime @default(now())
}
```

## 🔐 Autenticação

### Neon Auth

```typescript
// lib/auth/server.ts
export async function getSession() {
  const token = cookies().get('auth_token');
  
  if (!token) return null;
  
  const session = await neonAuth.verifyToken(token.value);
  return session;
}

export async function requireAuth() {
  const session = await getSession();
  
  if (!session) {
    redirect('/auth/login');
  }
  
  return session;
}
```

## 🚀 API Gateway

### Provider Abstraction

```typescript
interface Provider {
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<StreamChunk>;
  listModels(): Promise<Model[]>;
}

class OpenAIProvider implements Provider {
  async complete(request: CompletionRequest) {
    // Implementação OpenAI
  }
}

class AnthropicProvider implements Provider {
  async complete(request: CompletionRequest) {
    // Implementação Anthropic
  }
}
```

## 📊 Monitoramento

### Usage Tracking

```typescript
model UsageLog {
  id        String   @id @default(cuid())
  userId    String
  provider  String
  model     String
  tokens    Int
  cost      Float
  createdAt DateTime @default(now())
}
```

## 🔧 Configuração

### Variáveis de Ambiente

```env
# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Auth
NEON_AUTH_BASE_URL=https://...
NEON_AUTH_COOKIE_SECRET=...

# Encryption
ENCRYPTION_KEY=...

# Providers (opcional)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## 📚 Recursos

- [Next.js Docs](https://nextjs.org/docs)
- [Prisma Docs](https://www.prisma.io/docs)
- [Hono Docs](https://hono.dev/)
- [Neon Docs](https://neon.tech/docs)

---

**Última atualização:** 2026-04-13
