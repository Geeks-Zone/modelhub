# 🔒 Política de Segurança

## Versões Suportadas

Atualmente, as seguintes versões do ModelHub recebem atualizações de segurança:

| Versão | Suportada          |
| ------ | ------------------ |
| 1.x.x  | :white_check_mark: |
| < 1.0  | :x:                |

## 🚨 Reportar uma Vulnerabilidade

A segurança do ModelHub é levada muito a sério. Se você descobriu uma vulnerabilidade de segurança, por favor, siga estas diretrizes:

### ⚠️ NÃO Faça

- **NÃO** abra uma issue pública no GitHub
- **NÃO** divulgue a vulnerabilidade publicamente antes de ser corrigida
- **NÃO** explore a vulnerabilidade além do necessário para demonstrá-la

### ✅ Faça

1. **Envie um relatório privado** para: security@modelhub.dev
2. **Inclua detalhes completos**:
   - Descrição da vulnerabilidade
   - Passos para reproduzir
   - Impacto potencial
   - Versão afetada
   - Sugestões de correção (se houver)

### 📧 Template de Relatório

```
Assunto: [SECURITY] Descrição breve da vulnerabilidade

Tipo de Vulnerabilidade:
[ ] SQL Injection
[ ] XSS (Cross-Site Scripting)
[ ] CSRF (Cross-Site Request Forgery)
[ ] Autenticação/Autorização
[ ] Exposição de Dados Sensíveis
[ ] Outro: ___________

Severidade Estimada:
[ ] Crítica
[ ] Alta
[ ] Média
[ ] Baixa

Descrição Detalhada:
[Descreva a vulnerabilidade]

Passos para Reproduzir:
1. [Passo 1]
2. [Passo 2]
3. [Passo 3]

Impacto:
[Descreva o impacto potencial]

Ambiente:
- Versão: [e.g., 1.0.0]
- OS: [e.g., Ubuntu 22.04]
- Node: [e.g., 22.0.0]

Prova de Conceito:
[Código, screenshots, logs, etc.]

Sugestões de Correção:
[Se houver]
```

## 🔄 Processo de Resposta

### Timeline

1. **Confirmação** - Dentro de 48 horas
   - Confirmaremos o recebimento do seu relatório
   - Forneceremos um ID de rastreamento

2. **Avaliação** - Dentro de 7 dias
   - Avaliaremos a severidade e impacto
   - Confirmaremos se é uma vulnerabilidade válida
   - Forneceremos uma estimativa de correção

3. **Correção** - Baseado na severidade
   - **Crítica**: 1-7 dias
   - **Alta**: 7-14 dias
   - **Média**: 14-30 dias
   - **Baixa**: 30-90 dias

4. **Divulgação** - Após correção
   - Publicaremos um security advisory
   - Creditaremos o descobridor (se desejado)
   - Lançaremos uma versão corrigida

### Classificação de Severidade

#### 🔴 Crítica
- Execução remota de código
- Acesso não autorizado a dados sensíveis
- Bypass completo de autenticação

#### 🟠 Alta
- Escalação de privilégios
- SQL Injection
- Exposição de credenciais

#### 🟡 Média
- XSS (Cross-Site Scripting)
- CSRF em funcionalidades importantes
- Vazamento de informações sensíveis

#### 🟢 Baixa
- Problemas de configuração
- Vazamento de informações não sensíveis
- Problemas que requerem interação significativa do usuário

## 🛡️ Práticas de Segurança

### Para Usuários

1. **Mantenha Atualizado**
   ```bash
   # Verifique atualizações regularmente
   git pull origin main
   pnpm install
   ```

2. **Proteja suas Credenciais**
   - Nunca commite arquivos `.env`
   - Use variáveis de ambiente seguras
   - Rotacione API keys regularmente

3. **Configure HTTPS**
   - Use sempre HTTPS em produção
   - Configure certificados SSL válidos

4. **Limite Acesso**
   - Use autenticação forte
   - Implemente rate limiting
   - Configure CORS adequadamente

### Para Desenvolvedores

1. **Validação de Input**
   ```typescript
   // Use Zod para validação
   const schema = z.object({
     email: z.string().email(),
     password: z.string().min(8)
   });
   ```

2. **Sanitização de Output**
   ```typescript
   // Escape HTML em outputs
   import DOMPurify from 'dompurify';
   const clean = DOMPurify.sanitize(dirty);
   ```

3. **Autenticação Segura**
   ```typescript
   // Use bcrypt para senhas
   import bcrypt from 'bcrypt';
   const hash = await bcrypt.hash(password, 10);
   ```

4. **Proteção contra CSRF**
   ```typescript
   // Use tokens CSRF
   import { csrf } from 'hono/csrf';
   app.use(csrf());
   ```

## 🔍 Auditoria de Segurança

### Dependências

```bash
# Verifique vulnerabilidades em dependências
pnpm audit

# Corrija automaticamente quando possível
pnpm audit fix
```

### Análise Estática

```bash
# Execute linting de segurança
pnpm lint

# Type checking
pnpm typecheck
```

### Testes de Segurança

```bash
# Execute testes
pnpm test

# Testes de integração
pnpm test:e2e
```

## 📋 Checklist de Segurança

### Antes do Deploy

- [ ] Todas as dependências estão atualizadas
- [ ] Não há vulnerabilidades conhecidas (`pnpm audit`)
- [ ] Variáveis de ambiente estão configuradas
- [ ] HTTPS está habilitado
- [ ] Rate limiting está configurado
- [ ] CORS está configurado corretamente
- [ ] Logs não expõem informações sensíveis
- [ ] Backup do banco de dados está configurado

### Configuração de Produção

```env
# .env.production
NODE_ENV="production"
REQUIRE_AUTH="true"
ALLOW_DEBUG_ENDPOINTS="false"
RATE_LIMIT_WINDOW_MS="60000"
RATE_LIMIT_MAX="100"
```

## 🏆 Hall da Fama

Agradecemos aos seguintes pesquisadores de segurança por reportarem vulnerabilidades de forma responsável:

<!-- Lista será atualizada conforme reportes -->

## 📚 Recursos

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Next.js Security Headers](https://nextjs.org/docs/advanced-features/security-headers)
- [Prisma Security](https://www.prisma.io/docs/guides/security)

## 📞 Contato

- **Email de Segurança**: security@modelhub.dev
- **PGP Key**: [Disponível em keybase.io/modelhub](https://keybase.io/modelhub)
- **Bug Bounty**: Em breve

## ⚖️ Divulgação Responsável

Seguimos os princípios de divulgação responsável:

1. Damos tempo adequado para correção antes da divulgação pública
2. Creditamos descobridores (se desejado)
3. Mantemos comunicação transparente
4. Publicamos advisories após correção

---

**Obrigado por ajudar a manter o ModelHub seguro! 🙏**
