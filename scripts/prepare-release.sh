#!/bin/bash

# Script para preparar o projeto para release
# Uso: ./scripts/prepare-release.sh

set -e

echo "🚀 Preparando ModelHub para Release..."
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Função para verificar
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1"
        exit 1
    fi
}

# 1. Verificar Node.js
echo "📦 Verificando dependências..."
node --version > /dev/null 2>&1
check "Node.js instalado"

pnpm --version > /dev/null 2>&1
check "pnpm instalado"

# 2. Instalar dependências
echo ""
echo "📥 Instalando dependências..."
pnpm install --frozen-lockfile
check "Dependências instaladas"

# 3. Lint
echo ""
echo "🔍 Verificando código..."
pnpm lint
check "Lint passou"

# 4. Type check
echo ""
echo "📝 Verificando tipos..."
pnpm typecheck
check "Type check passou"

# 5. Testes
echo ""
echo "🧪 Executando testes..."
pnpm test
check "Testes passaram"

# 6. Build
echo ""
echo "🏗️  Fazendo build..."
pnpm build
check "Build concluído"

# 7. Verificar vulnerabilidades
echo ""
echo "🔒 Verificando vulnerabilidades..."
pnpm audit --audit-level=high
check "Sem vulnerabilidades críticas"

# 8. Verificar arquivos essenciais
echo ""
echo "📄 Verificando arquivos essenciais..."

files=(
    "README.md"
    "LICENSE"
    "CONTRIBUTING.md"
    "CODE_OF_CONDUCT.md"
    "SECURITY.md"
    "CHANGELOG.md"
    ".github/PULL_REQUEST_TEMPLATE.md"
    ".github/workflows/ci.yml"
    "Dockerfile"
    "docker-compose.yml"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file existe"
    else
        echo -e "${RED}✗${NC} $file não encontrado"
        exit 1
    fi
done

# 9. Verificar URLs
echo ""
echo "🔗 Verificando URLs..."
if grep -r "Geeks-Zone" . --exclude-dir={node_modules,.next,dist,build} > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠${NC}  Encontradas URLs com 'Geeks-Zone' - atualize antes de publicar"
    grep -r "Geeks-Zone" . --exclude-dir={node_modules,.next,dist,build} | head -5
else
    echo -e "${GREEN}✓${NC} URLs verificadas"
fi

# 10. Verificar .env
echo ""
echo "🔐 Verificando configuração..."
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠${NC}  Arquivo .env não encontrado"
    echo "   Copie .env.example para .env e configure"
else
    echo -e "${GREEN}✓${NC} Arquivo .env existe"
fi

# 11. Verificar Git
echo ""
echo "📊 Verificando Git..."
if [ -d ".git" ]; then
    echo -e "${GREEN}✓${NC} Repositório Git inicializado"
    
    # Verificar branch
    branch=$(git branch --show-current)
    echo "   Branch atual: $branch"
    
    # Verificar status
    if [ -n "$(git status --porcelain)" ]; then
        echo -e "${YELLOW}⚠${NC}  Há mudanças não commitadas"
    else
        echo -e "${GREEN}✓${NC} Working directory limpo"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Git não inicializado"
    echo "   Execute: git init"
fi

# Resumo
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}✅ Projeto pronto para release!${NC}"
echo ""
echo "📋 Próximos passos:"
echo "   1. Atualize URLs (Geeks-Zone → seu username)"
echo "   2. Adicione screenshots ao README"
echo "   3. Configure .env se necessário"
echo "   4. Commit e push"
echo "   5. Crie release v1.0.0"
echo "   6. Anuncie!"
echo ""
echo "📚 Consulte:"
echo "   - PROJETO_PRONTO.md"
echo "   - .github/RELEASE_GUIDE.md"
echo "   - .github/PROJECT_CHECKLIST.md"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
