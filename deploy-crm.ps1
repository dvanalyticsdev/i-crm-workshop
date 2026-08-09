param(
  [string]$Branch = "main",
  [string]$Remote = "origin",
  [string]$Server = "deploy@200.141.15.110",
  [string]$AppDir = "/var/www/i-crm",
  [string]$Pm2Name = "i-crm",
  [switch]$SkipPush,
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"

function Assert-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found."
  }
}

Assert-Command git
Assert-Command ssh

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

$currentBranch = git branch --show-current
if ($currentBranch -ne $Branch) {
  throw "You are on branch '$currentBranch'. Switch to '$Branch' before deploying."
}

$dirty = git status --porcelain
if ($dirty -and -not $AllowDirty) {
  Write-Host "Your working tree has uncommitted changes:" -ForegroundColor Yellow
  git status --short
  throw "Commit or stash changes first, then run this script again."
}

Write-Host "Deploying i-CRM from $Remote/$Branch to $Server..." -ForegroundColor Cyan

if (-not $SkipPush) {
  Write-Host "Pushing local commits to GitHub..." -ForegroundColor Cyan
  git push $Remote $Branch
}

$remoteScript = @"
set -e
cd '$AppDir'
git fetch '$Remote' '$Branch'
git checkout '$Branch'
git pull --ff-only '$Remote' '$Branch'
npm install --omit=dev
pm2 restart '$Pm2Name' --update-env
pm2 save
curl -fsS http://127.0.0.1:3000/api/ping
"@

Write-Host "Updating CRM on VPS..." -ForegroundColor Cyan
$remoteScript | ssh $Server "bash -s"

Write-Host ""
Write-Host "Deployment complete: https://crm.dvanalyticsmds.in" -ForegroundColor Green
