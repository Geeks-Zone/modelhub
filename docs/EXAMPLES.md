# 💡 Exemplos de Uso

Exemplos práticos de como usar o ModelHub em diferentes cenários.

## 📋 Índice

- [Exemplos de API](#exemplos-de-api)
- [Exemplos de SDK](#exemplos-de-sdk)
- [Casos de Uso](#casos-de-uso)
- [Integrações](#integrações)

## 🔌 Exemplos de API

### Chat Simples

```bash
curl -X POST https://your-modelhub.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Olá! Como você está?"}
    ]
  }'
```

### Chat com Sistema

```bash
curl -X POST https://your-modelhub.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [
      {
        "role": "system",
        "content": "Você é um assistente especializado em programação Python."
      },
      {
        "role": "user",
        "content": "Como criar uma lista em Python?"
      }
    ],
    "temperature": 0.7,
    "max_tokens": 500
  }'
```

### Streaming

```bash
curl -X POST https://your-modelhub.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Conte uma história curta"}
    ],
    "stream": true
  }'
```

### Listar Modelos

```bash
curl https://your-modelhub.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## 🐍 Python

### Básico

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://your-modelhub.com/v1"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "Olá!"}
    ]
)

print(response.choices[0].message.content)
```

### Com Streaming

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://your-modelhub.com/v1"
)

stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Conte uma história"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Múltiplas Mensagens

```python
messages = [
    {"role": "system", "content": "Você é um poeta."},
    {"role": "user", "content": "Escreva um haiku sobre programação"},
    {"role": "assistant", "content": "Código flui suave\nBugs dançam na tela brilhante\nDebug traz a paz"},
    {"role": "user", "content": "Agora sobre café"}
]

response = client.chat.completions.create(
    model="claude-3-5-sonnet-20241022",
    messages=messages
)

print(response.choices[0].message.content)
```

### Comparar Provedores

```python
from openai import OpenAI
import time

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://your-modelhub.com/v1"
)

models = ["gpt-4", "claude-3-5-sonnet-20241022", "gemini-2.0-flash-exp"]
prompt = "Explique inteligência artificial em uma frase."

for model in models:
    start = time.time()
    
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )
    
    elapsed = time.time() - start
    
    print(f"\n{model}:")
    print(f"Resposta: {response.choices[0].message.content}")
    print(f"Tempo: {elapsed:.2f}s")
    print(f"Tokens: {response.usage.total_tokens}")
```

## 📘 JavaScript/TypeScript

### Node.js Básico

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://your-modelhub.com/v1'
});

async function chat() {
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'user', content: 'Olá!' }
    ]
  });

  console.log(response.choices[0].message.content);
}

chat();
```

### Com Streaming

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://your-modelhub.com/v1'
});

async function streamChat() {
  const stream = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Conte uma história' }],
    stream: true
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    process.stdout.write(content);
  }
}

streamChat();
```

### React Component

```tsx
'use client';

import { useState } from 'react';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_API_KEY!,
  baseURL: 'https://your-modelhub.com/v1',
  dangerouslyAllowBrowser: true // Apenas para demo
});

export function ChatComponent() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: message }]
      });

      setResponse(completion.choices[0].message.content || '');
    } catch (error) {
      console.error('Erro:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Digite sua mensagem..."
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Enviando...' : 'Enviar'}
        </button>
      </form>
      {response && <div>{response}</div>}
    </div>
  );
}
```

## 🎯 Casos de Uso

### Chatbot de Suporte

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://your-modelhub.com/v1"
)

def support_bot(user_message: str, conversation_history: list):
    messages = [
        {
            "role": "system",
            "content": """Você é um assistente de suporte técnico.
            Seja educado, claro e objetivo.
            Se não souber a resposta, admita e ofereça alternativas."""
        }
    ]
    
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})
    
    response = client.chat.completions.create(
        model="gpt-4",
        messages=messages,
        temperature=0.7
    )
    
    return response.choices[0].message.content

# Uso
history = []
user_msg = "Como resetar minha senha?"
bot_response = support_bot(user_msg, history)
print(bot_response)
```

### Análise de Sentimento

```python
def analyze_sentiment(text: str):
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {
                "role": "system",
                "content": "Analise o sentimento do texto e responda apenas: positivo, negativo ou neutro."
            },
            {
                "role": "user",
                "content": text
            }
        ],
        temperature=0
    )
    
    return response.choices[0].message.content.lower()

# Uso
text = "Adorei este produto! Superou minhas expectativas."
sentiment = analyze_sentiment(text)
print(f"Sentimento: {sentiment}")
```

### Gerador de Código

```python
def generate_code(description: str, language: str = "python"):
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {
                "role": "system",
                "content": f"Você é um especialista em {language}. Gere código limpo e bem documentado."
            },
            {
                "role": "user",
                "content": f"Crie uma função que: {description}"
            }
        ],
        temperature=0.3
    )
    
    return response.choices[0].message.content

# Uso
code = generate_code("ordena uma lista de dicionários por uma chave específica")
print(code)
```

### Resumo de Texto

```python
def summarize(text: str, max_words: int = 100):
    response = client.chat.completions.create(
        model="claude-3-5-sonnet-20241022",
        messages=[
            {
                "role": "system",
                "content": f"Resuma o texto em no máximo {max_words} palavras."
            },
            {
                "role": "user",
                "content": text
            }
        ],
        temperature=0.5
    )
    
    return response.choices[0].message.content

# Uso
long_text = """[Texto longo aqui]"""
summary = summarize(long_text, max_words=50)
print(summary)
```

## 🔗 Integrações

### Langchain

```python
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage

llm = ChatOpenAI(
    openai_api_key="YOUR_API_KEY",
    openai_api_base="https://your-modelhub.com/v1",
    model_name="gpt-4"
)

messages = [
    SystemMessage(content="Você é um assistente útil."),
    HumanMessage(content="Olá!")
]

response = llm(messages)
print(response.content)
```

### LlamaIndex

```python
from llama_index.llms import OpenAI

llm = OpenAI(
    api_key="YOUR_API_KEY",
    api_base="https://your-modelhub.com/v1",
    model="gpt-4"
)

response = llm.complete("Explique inteligência artificial")
print(response)
```

### Discord Bot

```python
import discord
from openai import OpenAI

client_openai = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://your-modelhub.com/v1"
)

intents = discord.Intents.default()
intents.message_content = True
bot = discord.Client(intents=intents)

@bot.event
async def on_message(message):
    if message.author == bot.user:
        return
    
    if message.content.startswith('!chat'):
        prompt = message.content[6:]
        
        response = client_openai.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        
        await message.channel.send(response.choices[0].message.content)

bot.run('YOUR_DISCORD_TOKEN')
```

### Slack Bot

```python
from slack_bolt import App
from openai import OpenAI

app = App(token="YOUR_SLACK_TOKEN")

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://your-modelhub.com/v1"
)

@app.message("hello")
def message_hello(message, say):
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": message['text']}]
    )
    
    say(response.choices[0].message.content)

app.start(port=3000)
```

## 📚 Recursos

- [Documentação da API](API.md)
- [OpenAI Python SDK](https://github.com/openai/openai-python)
- [OpenAI Node.js SDK](https://github.com/openai/openai-node)
- [Langchain Docs](https://python.langchain.com/)
- [LlamaIndex Docs](https://docs.llamaindex.ai/)

---

**Tem um exemplo interessante?** Contribua com esta documentação!
