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
DEPLOY_VERSION=`$(git rev-parse --short=12 HEAD)
printf "%s\n" "`$DEPLOY_VERSION" > .version
npm ci --omit=dev || npm install --omit=dev
if pm2 describe '$Pm2Name' >/dev/null 2>&1; then
  pm2 reload '$Pm2Name' --update-env
else
  pm2 start server.js --name '$Pm2Name' --update-env
fi
pm2 save
for i in `$(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then
    curl -fsS http://127.0.0.1:3000/api/version
    exit 0
  fi
  sleep 1
done
echo "CRM did not become healthy after deploy." >&2
pm2 status '$Pm2Name'
exit 1
"@

Write-Host "Updating CRM on VPS..." -ForegroundColor Cyan
$remoteScript | ssh $Server "bash -s"

Write-Host ""
Write-Host "Deployment complete: https://crm.dvanalyticsmds.in" -ForegroundColor Green
