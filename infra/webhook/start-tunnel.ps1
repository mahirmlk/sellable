#!/usr/bin/env pwsh
# Start a zrok public tunnel for Razorpay webhook testing.
#
# Usage:
#   .\infra\webhook\start-tunnel.ps1
#   .\infra\webhook\start-tunnel.ps1 -Port 8000
#
# Requires:
#   - ZROK_ENABLE_TOKEN environment variable
#   - tools/zrok/zrok2.exe (downloaded separately)

param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$zrok = Join-Path $projectRoot "tools\zrok\zrok2.exe"

if (-not (Test-Path -LiteralPath $zrok)) {
    throw "zrok2 is not installed at $zrok. Download the official Windows binary before running this script."
}

$zrokToken = $env:ZROK_ENABLE_TOKEN
& $zrok status *> $null
if ($LASTEXITCODE -ne 0) {
    if ([string]::IsNullOrWhiteSpace($zrokToken) -or $zrokToken -eq "replace_me") {
        throw "Set ZROK_ENABLE_TOKEN in the shell before starting the public webhook share."
    }
    & $zrok enable $zrokToken --headless
}

Write-Host "Starting a public zrok share for http://localhost:$Port."
Write-Host "Configure the printed HTTPS URL plus /webhooks/razorpay in Razorpay Test mode."
& $zrok share public "localhost:$Port" --backend-mode proxy --open --headless
