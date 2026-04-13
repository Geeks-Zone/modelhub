# Script PowerShell para atualizar URLs do projeto
# Uso: .\scripts\update-urls.ps1 -Username "SEU_USERNAME"

param(
    [Parameter(Mandatory=$true)]
    [string]$Username
)

Write-Host "`n🔄 Atualizando URLs..." -ForegroundColor Cyan
Write-Host "   Geeks-Zone → $Username`n" -ForegroundColor Yellow

# Arquivos a atualizar
$files = @(
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "ROADMAP.md",
    "LEIA-ME.md",
    "PROJETO_PRONTO.md",
    "package.json",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/SUPPORT.md",
    ".github/RELEASE_GUIDE.md",
    ".github/PROJECT_CHECKLIST.md",
    ".github/CODEOWNERS",
    ".github/FUNDING.yml",
    ".github/dependabot.yml",
    ".github/workflows/release.yml",
    "docs/API.md",
    "docs/DEPLOYMENT.md",
    "docs/EXAMPLES.md",
    "docs/FAQ.md",
    "docs/QUICKSTART.md"
)

# Criar backup
Write-Host "📦 Criando backup..." -ForegroundColor Cyan
$backupDir = ".backup"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

foreach ($file in $files) {
    if (Test-Path $file) {
        $backupFile = Join-Path $backupDir (Split-Path $file -Leaf)
        Copy-Item $file $backupFile -Force
    }
}

# Atualizar arquivos
Write-Host "`n✏️  Atualizando arquivos..." -ForegroundColor Cyan
$count = 0

foreach ($file in $files) {
    if (Test-Path $file) {
        $content = Get-Content $file -Raw -Encoding UTF8
        $newContent = $content -replace 'Geeks-Zone', $Username
        
        if ($content -ne $newContent) {
            Set-Content $file $newContent -Encoding UTF8 -NoNewline
            Write-Host "   ✓ $file" -ForegroundColor Green
            $count++
        }
    }
}

Write-Host "`n✅ $count arquivo(s) atualizado(s)!" -ForegroundColor Green
Write-Host "`n📋 Próximos passos:" -ForegroundColor Cyan
Write-Host "   1. Revise as mudanças: git diff" -ForegroundColor White
Write-Host "   2. Se estiver OK: git add . && git commit -m 'chore: update URLs'" -ForegroundColor White
Write-Host "   3. Se houver erro: restaure do .backup/`n" -ForegroundColor White
