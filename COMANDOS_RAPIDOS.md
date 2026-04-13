# ⚡ Comandos Rápidos - Copie e Cole

## 🎯 Setup Inicial (Execute na ordem)

### 1. Atualizar URLs
```powershell
# IMPORTANTE: Substitua SEU_USERNAME pelo seu username do GitHub
.\scripts\update-urls.ps1 -Username "SEU_USERNAME"
```

### 2. Revisar mudanças
```bash
git diff
```

### 3. Adicionar tudo ao Git
```bash
git add .
```

### 4. Commit
```bash
git commit -m "docs: complete open source setup with best practices"
```

### 5. Conectar ao GitHub
```bash
# IMPORTANTE: Substitua SEU_USERNAME pelo seu username
git remote add origin https://github.com/SEU_USERNAME/modelhub.git
git branch -M main
git push -u origin main
```

### 6. Criar tag de release
```bash
git tag -a v1.0.0 -m "Release v1.0.0 - Initial release"
git push origin v1.0.0
```

## 🔍 Verificação

### Verificar se está tudo OK
```powershell
.\scripts\prepare-release.ps1
```

### Ver status do Git
```bash
git status
```

### Ver histórico de commits
```bash
git log --oneline
```

### Ver remotes configurados
```bash
git remote -v
```

## 🛠️ Desenvolvimento

### Instalar dependências
```bash
pnpm install
```

### Iniciar servidor de desenvolvimento
```bash
pnpm dev
```

### Fazer build
```bash
pnpm build
```

### Executar testes
```bash
pnpm test
```

### Verificar lint
```bash
pnpm lint
```

### Verificar tipos
```bash
pnpm typecheck
```

### Executar migrações
```bash
pnpm prisma:migrate
```

## 🐳 Docker

### Build da imagem
```bash
docker build -t modelhub:latest .
```

### Executar container
```bash
docker run -d -p 3000:3000 --env-file .env modelhub:latest
```

### Com Docker Compose
```bash
docker-compose up -d
```

### Ver logs
```bash
docker-compose logs -f
```

### Parar containers
```bash
docker-compose down
```

## 📦 Configuração

### Copiar .env de exemplo
```bash
cp .env.example .env
```

### Gerar ENCRYPTION_KEY
```bash
openssl rand -hex 32
```

### Gerar NEON_AUTH_COOKIE_SECRET
```bash
openssl rand -base64 32
```

## 🔄 Atualizações Futuras

### Atualizar dependências
```bash
pnpm update
```

### Verificar vulnerabilidades
```bash
pnpm audit
```

### Corrigir vulnerabilidades
```bash
pnpm audit fix
```

## 📝 Releases

### Criar nova versão (patch)
```bash
npm version patch
git push origin main --tags
```

### Criar nova versão (minor)
```bash
npm version minor
git push origin main --tags
```

### Criar nova versão (major)
```bash
npm version major
git push origin main --tags
```

## 🧹 Limpeza

### Limpar build
```bash
rm -rf .next
```

### Limpar node_modules
```bash
rm -rf node_modules
pnpm install
```

### Limpar tudo e reinstalar
```bash
rm -rf .next node_modules
pnpm install
pnpm build
```

## 🔧 Troubleshooting

### Porta 3000 em uso
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :3000
kill -9 <PID>
```

### Resetar Git (CUIDADO!)
```bash
# Remove histórico Git (use com cautela)
rm -rf .git
git init
git add .
git commit -m "Initial commit"
```

### Desfazer último commit (mantém mudanças)
```bash
git reset --soft HEAD~1
```

### Desfazer último commit (descarta mudanças)
```bash
git reset --hard HEAD~1
```

## 📊 Informações

### Ver versão do Node
```bash
node --version
```

### Ver versão do pnpm
```bash
pnpm --version
```

### Ver versão do Git
```bash
git --version
```

### Ver informações do projeto
```bash
cat package.json | grep version
```

## 🎯 Comandos Úteis do Git

### Ver diferenças
```bash
git diff                    # Mudanças não staged
git diff --staged          # Mudanças staged
git diff HEAD              # Todas as mudanças
```

### Ver histórico
```bash
git log                    # Histórico completo
git log --oneline          # Histórico resumido
git log --graph            # Histórico com gráfico
```

### Branches
```bash
git branch                 # Listar branches
git branch nova-feature    # Criar branch
git checkout nova-feature  # Mudar para branch
git checkout -b nova-feature  # Criar e mudar
```

### Desfazer mudanças
```bash
git restore arquivo.txt    # Desfazer mudanças em arquivo
git restore --staged arquivo.txt  # Unstage arquivo
git clean -fd              # Remover arquivos não rastreados
```

## 🚀 Deploy

### Vercel
```bash
# Instalar CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

### Docker Hub
```bash
# Login
docker login

# Tag
docker tag modelhub:latest Geeks-Zone/modelhub:latest

# Push
docker push Geeks-Zone/modelhub:latest
```

## 📱 Redes Sociais

### Gerar hash para Twitter
```bash
echo -n "ModelHub" | md5sum
```

### Encurtar URL
Use: https://bit.ly ou https://tinyurl.com

## 💡 Dicas Rápidas

### Alias úteis (adicione ao .bashrc ou .zshrc)
```bash
alias gs='git status'
alias ga='git add .'
alias gc='git commit -m'
alias gp='git push'
alias gl='git log --oneline'
alias dev='pnpm dev'
alias build='pnpm build'
```

### Variáveis de ambiente rápidas
```bash
# Desenvolvimento
export NODE_ENV=development

# Produção
export NODE_ENV=production

# Debug
export DEBUG=*
```

## 🎊 Pronto!

Agora você tem todos os comandos necessários em um só lugar!

**Comece com:**
```powershell
.\scripts\update-urls.ps1 -Username "SEU_USERNAME"
```

**Boa sorte! 🚀**
