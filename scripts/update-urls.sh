#!/bin/bash

# Script para atualizar URLs do projeto
# Uso: ./scripts/update-urls.sh SEU_USERNAME

set -e

if [ -z "$1" ]; then
    echo "❌ Erro: Username não fornecido"
    echo "Uso: ./scripts/update-urls.sh SEU_USERNAME"
    exit 1
fi

USERNAME=$1

echo "🔄 Atualizando URLs..."
echo "   actus7 → $USERNAME"
echo ""

# Arquivos a atualizar
files=(
    "README.md"
    "CONTRIBUTING.md"
    "SECURITY.md"
    "CHANGELOG.md"
    "ROADMAP.md"
    "package.json"
    ".github/ISSUE_TEMPLATE/config.yml"
    ".github/SUPPORT.md"
    ".github/RELEASE_GUIDE.md"
    "docs/API.md"
    "docs/DEPLOYMENT.md"
    "docs/EXAMPLES.md"
    "docs/FAQ.md"
    "docs/QUICKSTART.md"
)

# Backup
echo "📦 Criando backup..."
mkdir -p .backup
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" ".backup/$(basename $file).bak"
    fi
done

# Atualizar
echo "✏️  Atualizando arquivos..."
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        sed -i "s/actus7/$USERNAME/g" "$file"
        echo "   ✓ $file"
    fi
done

echo ""
echo "✅ URLs atualizadas!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Revise as mudanças: git diff"
echo "   2. Se estiver OK: git add . && git commit -m 'chore: update URLs'"
echo "   3. Se houver erro: cp .backup/*.bak para restaurar"
echo ""
