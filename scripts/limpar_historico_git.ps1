param(
    [string]$RepoPath = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
    param([string[]]$GitArgs)

    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "O comando Git falhou: git $($GitArgs -join ' ')"
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git nao foi encontrado no computador. Instale o Git antes de continuar."
}

$repoOutput = & git -C $RepoPath rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or -not $repoOutput) {
    throw "A pasta informada nao e um repositorio Git valido."
}
$repoRoot = ($repoOutput | Select-Object -First 1).Trim()

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$parent = Split-Path $repoRoot -Parent
$cleanRepo = Join-Path $parent "ValoraCrm_historico_limpo_$timestamp.git"
$backupBundle = Join-Path $parent "ValoraCrm_historico_original_$timestamp.bundle"

Write-Host "1/5 Criando backup completo do historico..."
Invoke-Git -GitArgs @("-C", $repoRoot, "bundle", "create", $backupBundle, "--all")

Write-Host "2/5 Criando uma copia espelho para limpeza..."
Invoke-Git -GitArgs @("clone", "--mirror", "--no-local", $repoRoot, $cleanRepo)

$remoteOutput = & git -C $repoRoot remote get-url origin 2>$null
$remoteUrl = ""
if ($LASTEXITCODE -eq 0 -and $remoteOutput) {
    $remoteUrl = ($remoteOutput | Select-Object -First 1).Trim()
}

Push-Location $cleanRepo
try {
    Write-Host "3/5 Removendo .env e .ENV de todos os commits e tags..."
    Invoke-Git -GitArgs @(
        "filter-branch",
        "--force",
        "--index-filter", "git rm --cached --ignore-unmatch .env .ENV",
        "--prune-empty",
        "--tag-name-filter", "cat",
        "--",
        "--all"
    )

    if (Test-Path "refs/original") {
        Remove-Item "refs/original" -Recurse -Force
    }

    Write-Host "4/5 Eliminando objetos antigos que ainda continham os arquivos..."
    Invoke-Git -GitArgs @("reflog", "expire", "--expire=now", "--all")
    Invoke-Git -GitArgs @("gc", "--prune=now", "--aggressive")

    $remaining = & git log --all --format="%H" -- .env .ENV
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel verificar o historico limpo."
    }
    if ($remaining) {
        throw "A verificacao encontrou referencias restantes a .env/.ENV no historico limpo."
    }

    if ($remoteUrl) {
        Invoke-Git -GitArgs @("remote", "set-url", "origin", $remoteUrl)
    }
}
finally {
    Pop-Location
}

Write-Host "5/5 Historico limpo criado com sucesso." -ForegroundColor Green
Write-Host ""
Write-Host "Backup do historico original: $backupBundle"
Write-Host "Repositorio limpo: $cleanRepo"
Write-Host ""
Write-Host "IMPORTANTE: credenciais expostas devem ser consideradas comprometidas."
Write-Host "Troque a senha do PostgreSQL e a senha de aplicativo do e-mail."
Write-Host "Depois de revisar o repositorio limpo, publique-o com:"
Write-Host "git -C `"$cleanRepo`" push --force --mirror origin"
Write-Host ""
Write-Host "Esse ultimo comando reescreve o historico remoto. Avise outros colaboradores antes de executa-lo."
