# Run the ESI Dashboard local test suite.
#
# Usage:
#   .\scripts\test-local.ps1                # run against an already-running server
#   .\scripts\test-local.ps1 -Start         # start main.py first, run tests, leave it running
#   .\scripts\test-local.ps1 -Start -Stop   # start, test, then kill the server
#   .\scripts\test-local.ps1 -Verbose
#
# Exits with code 0 on success, 1 on any failure.

[CmdletBinding()]
param(
    [string]$Base = "http://localhost:5000",
    [switch]$Start,
    [switch]$Stop,
    [switch]$SkipRateLimit,
    [int]$StartupTimeoutSec = 30
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Test-Up {
    try {
        $r = Invoke-WebRequest -Uri "$Base/" -Method Head -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        return $r.StatusCode -lt 500
    } catch {
        return $false
    }
}

$serverProc = $null

if ($Start -and -not (Test-Up)) {
    Write-Host "Starting main.py..." -ForegroundColor Cyan
    $serverProc = Start-Process -FilePath "python" `
        -ArgumentList "main.py" `
        -WorkingDirectory $repoRoot `
        -PassThru -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Up) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Up)) {
        Write-Host "Server failed to start within $StartupTimeoutSec s" -ForegroundColor Red
        if ($serverProc) { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue }
        exit 1
    }
    Write-Host "Server is up." -ForegroundColor Green
}

# build python args
$pyArgs = @("$repoRoot\scripts\test_local.py", "--base", $Base)
if ($VerbosePreference -eq "Continue") { $pyArgs += "--verbose" }
if ($SkipRateLimit)                    { $pyArgs += "--skip-rate-limit" }

try {
    & python @pyArgs
    $code = $LASTEXITCODE
} finally {
    if ($Stop -and $serverProc) {
        Write-Host "Stopping server (pid $($serverProc.Id))..." -ForegroundColor Cyan
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    }
}

exit $code
