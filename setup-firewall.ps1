# PowerShell script to configure Windows Firewall for Van System
# Run this script as Administrator
# This script allows all ports for all network profiles (Domain, Private, Public)

$ErrorActionPreference = "Stop"

Write-Host "Configuring Windows Firewall for Van System..." -ForegroundColor Green
Write-Host "Allowing ports for all network profiles (Domain, Private, Public)..." -ForegroundColor Yellow
Write-Host ""

$rules = @(
    @{ Name = "Van System - Vite Server"; Port = 8090; Label = "Vite Server" },
    @{ Name = "Van System - WebSocket Server"; Port = 8091; Label = "WebSocket Server" },
    @{ Name = "Van System - RTSP Converter"; Port = 8092; Label = "RTSP Converter" }
)

Write-Host "Removing existing rules (if any)..." -ForegroundColor Cyan
foreach ($rule in $rules) {
    Remove-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
}
Write-Host ""

foreach ($rule in $rules) {
    New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Direction Inbound `
        -LocalPort $rule.Port `
        -Protocol TCP `
        -Action Allow `
        -Profile Any `
        -ErrorAction SilentlyContinue | Out-Null

    Write-Host ("[OK] Port {0} ({1}) - Allowed for all networks" -f $rule.Port, $rule.Label) -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Firewall configuration complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "All ports are now accessible from:" -ForegroundColor Yellow
Write-Host "  - Domain networks" -ForegroundColor White
Write-Host "  - Private networks" -ForegroundColor White
Write-Host "  - Public networks" -ForegroundColor White
Write-Host ""
Write-Host "The app is now accessible from any device on any network." -ForegroundColor Cyan
