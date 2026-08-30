# Deploys the already-built workspace to the app directory and restarts the
# Windows service. Run by the Deploy workflow on the self-hosted runner, from
# the repo root after `npm ci` and `npm run build`.
#
# The live SQLite database is NOT under the app directory: the service sets
# JOBTRACKER_DATA_DIR (e.g. C:\JobTrackerData). The /XD exclusions below keep
# robocopy away from any data/ folder regardless.
param(
    [string]$AppDir = $(if ($env:JOBTRACKER_APP_DIR) { $env:JOBTRACKER_APP_DIR } else { 'C:\Apps\JobTracker' }),
    [string]$ServiceName = $(if ($env:JOBTRACKER_SERVICE) { $env:JOBTRACKER_SERVICE } else { 'JobTracker' })
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $PSScriptRoot '..\..\dist\index.html'))) {
    throw 'dist/ is missing — run "npm run build" before deploying'
}

New-Item -ItemType Directory -Force $AppDir | Out-Null

$service = Get-Service $ServiceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') {
    Write-Host "Stopping service $ServiceName..."
    Stop-Service $ServiceName -Force
    $service.WaitForStatus('Stopped', (New-TimeSpan -Seconds 30))
}

Write-Host "Copying to $AppDir..."
# Mirror the app files; /XD-excluded directories are left untouched on the
# destination (data/ especially). node_modules is rebuilt below with only
# production dependencies.
robocopy . $AppDir /MIR /NFL /NDL /NJH `
    /XD .git .github node_modules data web scripts\runner `
    /XF .env
# robocopy: exit codes 0-7 mean success.
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

Write-Host 'Installing production dependencies...'
Push-Location $AppDir
try {
    npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

if ($service) {
    Write-Host "Starting service $ServiceName..."
    Start-Service $ServiceName
    (Get-Service $ServiceName).WaitForStatus('Running', (New-TimeSpan -Seconds 30))
    Write-Host 'Deployed and running.'
} else {
    Write-Host "Service $ServiceName not installed — files deployed, no restart. See docs/deployment.md for service setup."
}

exit 0
