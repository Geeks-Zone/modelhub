# ðŸ’¡ Exemplos de Uso

Exemplos prÃ¡ticos de como usar o ModelHub em diferentes cenÃ¡rios.

## ðŸ“‹ Ãndice

- [Exemplos de API](#exemplos-de-api)
- [Exemplos de SDK](#exemplos-de-sdk)
- [Casos de Uso](#casos-de-uso)
- [IntegraÃ§Ãµes](#integraÃ§Ãµes)

## ðŸ”Œ Exemplos de API

### Chat Simples

```bash
curl -X POST https://www.modelhub.com.br/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "OlÃ¡! Como vocÃª estÃ¡?"}
    ]
  }'
```

### Chat com Sistema

```bash
curl -X POST https://www.modelhub.com.br/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [
      {
        "role": "system",
        "content": "VocÃª Ã© um assistente especializado em programaÃ§Ã£o Python."
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
curl -X POST https://www.modelhub.com.br/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Conte uma histÃ³ria curta"}
    ],
    "stream": true
  }'
```

### Listar Modelos

```bash
curl https://www.modelhub.com.br/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## ðŸ Python

### BÃ¡sico

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://www.modelhub.com.br/v1"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "OlÃ¡!"}
    ]
)

print(response.choices[0].message.content)
```

### Com Streaming

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://www.modelhub.com.br/v1"
)

stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Conte uma histÃ³ria"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### MÃºltiplas Mensagens

```python
messages = [
    {"role": "system", "content": "VocÃª Ã© um poeta."},
    {"role": "user", "content": "Escreva um haiku sobre programaÃ§Ã£o"},
    {"role": "assistant", "content": "CÃ³digo flui suave\nBugs danÃ§am na tela brilhante\nDebug traz a paz"},
    {"role": "user", "content": "Agora sobre cafÃ©"}
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
    base_url="https://www.modelhub.com.br/v1"
)

models = ["gpt-4", "claude-3-5-sonnet-20241022", "gemini-2.0-flash-exp"]
prompt = "Explique inteligÃªncia artificial em uma frase."

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

## ðŸ“˜ JavaScript/TypeScript

### Node.js BÃ¡sico

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://www.modelhub.com.br/v1'
});

async function chat() {
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'user', content: 'OlÃ¡!' }
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
  baseURL: 'https://www.modelhub.com.br/v1'
});

async function streamChat() {
  const stream = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Conte uma histÃ³ria' }],
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
  baseURL: 'https://www.modelhub.com.br/v1',
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

## ðŸŽ¯ Casos de Uso

### Chatbot de Suporte

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://www.modelhub.com.br/v1"
)

def support_bot(user_message: str, conversation_history: list):
    messages = [
        {
            "role": "system",
            "content": """VocÃª Ã© um assistente de suporte tÃ©cnico.
            Seja educado, claro e objetivo.
            Se nÃ£o souber a resposta, admita e ofereÃ§a alternativas."""
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

### AnÃ¡lise de Sentimento

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

### Gerador de CÃ³digo

```python
def generate_code(description: str, language: str = "python"):
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {
                "role": "system",
                "content": f"VocÃª Ã© um especialista em {language}. Gere cÃ³digo limpo e bem documentado."
            },
            {
                "role": "user",
                "content": f"Crie uma funÃ§Ã£o que: {description}"
            }
        ],
        temperature=0.3
    )
    
    return response.choices[0].message.content

# Uso
code = generate_code("ordena uma lista de dicionÃ¡rios por uma chave especÃ­fica")
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
                "content": f"Resuma o texto em no mÃ¡ximo {max_words} palavras."
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

## ðŸ”— IntegraÃ§Ãµes

### Langchain

```python
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage

llm = ChatOpenAI(
    openai_api_key="YOUR_API_KEY",
    openai_api_base="https://www.modelhub.com.br/v1",
    model_name="gpt-4"
)

messages = [
    SystemMessage(content="VocÃª Ã© um assistente Ãºtil."),
    HumanMessage(content="OlÃ¡!")
]

response = llm(messages)
print(response.content)
```

### LlamaIndex

```python
from llama_index.llms import OpenAI

llm = OpenAI(
    api_key="YOUR_API_KEY",
    api_base="https://www.modelhub.com.br/v1",
    model="gpt-4"
)

response = llm.complete("Explique inteligÃªncia artificial")
print(response)
```

### Discord Bot

```python
import discord
from openai import OpenAI

client_openai = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://www.modelhub.com.br/v1"
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
    base_url="https://www.modelhub.com.br/v1"
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

## ðŸ“š Recursos

- [DocumentaÃ§Ã£o da API](API.md)
- [OpenAI Python SDK](https://github.com/openai/openai-python)
- [OpenAI Node.js SDK](https://github.com/openai/openai-node)
- [Langchain Docs](https://python.langchain.com/)
- [LlamaIndex Docs](https://docs.llamaindex.ai/)

---

**Tem um exemplo interessante?** Contribua com esta documentaÃ§Ã£o!

