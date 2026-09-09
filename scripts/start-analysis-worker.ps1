# DocMind — worker d'analyse local (définitif pour Vercel + Ollama sur ce PC)
#
# Architecture :
#   - Vercel enregistre les jobs (P1 preview + enqueue)
#   - CE script drain la file via Postgres + Ollama local (127.0.0.1)
#   - Pas de tunnel Cloudflare requis
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File scripts\start-analysis-worker.ps1
# Autostart : enregistré via schtasks (DocMindAnalysisWorker)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = $PSScriptRoot
}
Set-Location $Root

$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "analysis-worker.log"

function Write-Log([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "o"), $Message
  Add-Content -Path $LogFile -Value $line -Encoding utf8
  Write-Host $line
}

# Ne pas hériter d'un DATABASE_URL IPv6 périmé du profil Windows / shell parent
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:OLLAMA_BASE_URL -ErrorAction SilentlyContinue

Write-Log "worker start root=$Root"
Write-Log "Assure-toi qu'Ollama tourne (http://127.0.0.1:11434)."

while ($true) {
  try {
    Write-Log "drain:watch launching..."
    # Intervalle 60s — file Vercel traitée rapidement avec Ollama local
    & npm run jobs:drain:watch -- --interval 60 --max 2
    $code = $LASTEXITCODE
    Write-Log "drain:watch exited code=$code — restart in 5s"
  }
  catch {
    Write-Log ("drain:watch error: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 5
}
