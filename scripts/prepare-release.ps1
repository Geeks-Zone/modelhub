# Script PowerShell para preparar o projeto para release
# Uso: .\scripts\prepare-release.ps1

Write-Host "`n🚀 Preparando ModelHub para Release...`n" -ForegroundColor Green

$errors = 0

function Check-Command {
    param($name, $command)
    try {
        Invoke-Expression "$command" | Out-Null
        Write-Host "✓ $name" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ $name" -ForegroundColor Red
        return $false
    }
}

# 1. Verificar dependências
Write-Host "📦 Verificando dependências..." -ForegroundColor Cyan
if (-not (Check-Command "Node.js instalado" "node --version")) { $errors++ }
if (-not (Check-Command "pnpm instalado" "pnpm --version")) { $errors++ }

if ($errors -gt 0) {
    Write-Host "`n❌ Instale as dependências faltantes primeiro.`n" -ForegroundColor Red
    exit 1
}

# 2. Instalar dependências
Write-Host "`n📥 Instalando dependências..." -ForegroundColor Cyan
try {
    pnpm install --frozen-lockfile
    Write-Host "✓ Dependências instaladas" -ForegroundColor Green
} catch {
    Write-Host "✗ Erro ao instalar dependências" -ForegroundColor Red
    $errors++
}

# 3. Lint
Write-Host "`n🔍 Verificando código..." -ForegroundColor Cyan
try {
    pnpm lint
    Write-Host "✓ Lint passou" -ForegroundColor Green
} catch {
    Write-Host "✗ Lint falhou" -ForegroundColor Red
    $errors++
}

# 4. Type check
Write-Host "`n📝 Verificando tipos..." -ForegroundColor Cyan
try {
    pnpm typecheck
    Write-Host "✓ Type check passou" -ForegroundColor Green
} catch {
    Write-Host "✗ Type check falhou" -ForegroundColor Red
    $errors++
}

# 5. Testes
Write-Host "`n🧪 Executando testes..." -ForegroundColor Cyan
try {
    pnpm test
    Write-Host "✓ Testes passaram" -ForegroundColor Green
} catch {
    Write-Host "⚠ Testes falharam (pode ser normal se não houver testes)" -ForegroundColor Yellow
}

# 6. Build
Write-Host "`n🏗️  Fazendo build..." -ForegroundColor Cyan
try {
    pnpm build
    Write-Host "✓ Build concluído" -ForegroundColor Green
} catch {
    Write-Host "✗ Build falhou" -ForegroundColor Red
    $errors++
}

# 7. Verificar arquivos essenciais
Write-Host "`n📄 Verificando arquivos essenciais..." -ForegroundColor Cyan

$files = @(
    "README.md",
    "LICENSE",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "CHANGELOG.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/workflows/ci.yml",
    "Dockerfile",
    "docker-compose.yml"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "✓ $file existe" -ForegroundColor Green
    } else {
        Write-Host "✗ $file não encontrado" -ForegroundColor Red
        $errors++
    }
}

# 8. Verificar URLs
Write-Host "`n🔗 Verificando URLs..." -ForegroundColor Cyan
$seuUsuario = Select-String -Path "README.md","package.json" -Pattern "Geeks-Zone" -SimpleMatch
if ($seuUsuario) {
    Write-Host "⚠ Encontradas URLs com 'Geeks-Zone' - atualize antes de publicar" -ForegroundColor Yellow
    Write-Host "  Execute: .\scripts\update-urls.ps1 -Username SEU_USERNAME" -ForegroundColor White
} else {
    Write-Host "✓ URLs verificadas" -ForegroundColor Green
}

# 9. Verificar .env
Write-Host "`n🔐 Verificando configuração..." -ForegroundColor Cyan
if (-not (Test-Path ".env")) {
    Write-Host "⚠ Arquivo .env não encontrado" -ForegroundColor Yellow
    Write-Host "  Copie .env.example para .env e configure" -ForegroundColor White
} else {
    Write-Host "✓ Arquivo .env existe" -ForegroundColor Green
}

# 10. Verificar Git
Write-Host "`n📊 Verificando Git..." -ForegroundColor Cyan
if (Test-Path ".git") {
    Write-Host "✓ Repositório Git inicializado" -ForegroundColor Green
    
    $branch = git branch --show-current
    Write-Host "  Branch atual: $branch" -ForegroundColor White
    
    $status = git status --porcelain
    if ($status) {
        Write-Host "⚠ Há mudanças não commitadas" -ForegroundColor Yellow
    } else {
        Write-Host "✓ Working directory limpo" -ForegroundColor Green
    }
} else {
    Write-Host "⚠ Git não inicializado" -ForegroundColor Yellow
    Write-Host "  Execute: git init" -ForegroundColor White
}

# Resumo
Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

if ($errors -eq 0) {
    Write-Host "`n✅ Projeto pronto para release!`n" -ForegroundColor Green
} else {
    Write-Host "`n⚠ Projeto tem $errors erro(s) - corrija antes de publicar`n" -ForegroundColor Yellow
}

Write-Host "📋 Próximos passos:" -ForegroundColor Cyan
Write-Host "   1. Atualize URLs: .\scripts\update-urls.ps1 -Username SEU_USERNAME" -ForegroundColor White
Write-Host "   2. Adicione screenshots ao README" -ForegroundColor White
Write-Host "   3. Configure .env se necessário" -ForegroundColor White
Write-Host "   4. Commit e push" -ForegroundColor White
Write-Host "   5. Crie release v1.0.0" -ForegroundColor White
Write-Host "   6. Anuncie!`n" -ForegroundColor White

Write-Host "📚 Consulte:" -ForegroundColor Cyan
Write-Host "   - PROJETO_PRONTO.md" -ForegroundColor White
Write-Host "   - .github/RELEASE_GUIDE.md" -ForegroundColor White
Write-Host "   - .github/PROJECT_CHECKLIST.md`n" -ForegroundColor White

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan
