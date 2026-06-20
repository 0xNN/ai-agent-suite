# ───────────────────────────────────────────────
#  AI Agents — Windows Install Script
# ───────────────────────────────────────────────
# Run this script from PowerShell as Administrator:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\docs\install.ps1
# ───────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Agents = @(
  "scan-agent",
  "code-reviewer-agent",
  "diff-reviewer-agent",
  "tasker-agent",
  "fixer-agent",
  "test-agent",
  "commit-agent",
  "orchestrator-agent"
)

$ExtDir = "$Root\vscode-extension\ai-code-agents"

# ─── Check Node.js ───
Write-Host "`n=== Checking Node.js ===" -ForegroundColor Cyan
try {
  $ver = node --version
  $major = [int]($ver -replace "v","" -split "\.")[0]
  if ($major -lt 18) { throw "Node.js $ver too old, need v18+" }
  Write-Host "  Node.js $ver detected ✓" -ForegroundColor Green
} catch {
  Write-Host "  Node.js not found or too old. Download from https://nodejs.org" -ForegroundColor Red
  exit 1
}

# ─── Install Agents ───
Write-Host "`n=== Installing Agents Globally ===" -ForegroundColor Cyan
foreach ($agent in $Agents) {
  $dir = "$Root\$agent"
  if (-not (Test-Path $dir)) {
    Write-Host "  [!] $agent directory not found, skipping" -ForegroundColor Yellow
    continue
  }
  Write-Host "  Installing $agent..." -ForegroundColor White
  Push-Location $dir
  npm install -g . 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ $agent installed" -ForegroundColor Green
  } else {
    Write-Host "  ❌ $agent failed" -ForegroundColor Red
  }
  Pop-Location
}

# ─── Install VS Code Extension ───
Write-Host "`n=== Installing VS Code Extension ===" -ForegroundColor Cyan

# Check vsce
$vsce = Get-Command "npx" -ErrorAction SilentlyContinue
if (-not $vsce) {
  Write-Host "  [!] npx not found, skipping extension packaging" -ForegroundColor Yellow
} elseif (-not (Test-Path $ExtDir)) {
  Write-Host "  [!] Extension directory not found at $ExtDir" -ForegroundColor Yellow
} else {
  Write-Host "  Compiling extension..." -ForegroundColor White
  Push-Location $ExtDir
  npm install 2>&1 | Out-Null
  npm run compile 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Extension compiled" -ForegroundColor Green
    Write-Host "  Packaging extension..." -ForegroundColor White
    npx @vscode/vsce package 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $vsix = Get-ChildItem -Path $ExtDir -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($vsix) {
        code --install-extension $vsix.FullName 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
          Write-Host "  ✅ VS Code extension installed" -ForegroundColor Green
        } else {
          Write-Host "  ❌ Failed to install extension in VS Code" -ForegroundColor Red
        }
      }
    } else {
      Write-Host "  ❌ Extension packaging failed" -ForegroundColor Red
    }
  } else {
    Write-Host "  ❌ Extension compilation failed" -ForegroundColor Red
  }
  Pop-Location
}

# ─── Verify ───
Write-Host "`n=== Verification ===" -ForegroundColor Cyan
$CLIs = @("ai-scanner", "code-reviewer-agent", "diff-reviewer", "tasker-agent", "fixer-agent", "test-agent", "commit-agent", "orchestrator")
foreach ($cli in $CLIs) {
  $found = Get-Command $cli -ErrorAction SilentlyContinue
  if ($found) {
    Write-Host "  ✅ $cli" -ForegroundColor Green
  } else {
    Write-Host "  ❌ $cli not found in PATH" -ForegroundColor Red
  }
}

Write-Host "`n=== Install Complete ===" -ForegroundColor Cyan
Write-Host "  Restart VS Code for the extension to take effect." -ForegroundColor White
