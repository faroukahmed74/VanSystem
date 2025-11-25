# PowerShell script to configure Windows Firewall for Van System
# Run this script as Administrator
# This script allows all ports for ALL network profiles (Domain, Private, Public)

Write-Host "Configuring Windows Firewall for Van System..." -ForegroundColor Green
Write-Host "Allowing ports for ALL network profiles (Domain, Private, Public)..." -ForegroundColor Yellow
Write-Host ""

# Remove existing rules if they exist (to avoid duplicates)
Write-Host "Removing existing rules (if any)..." -ForegroundColor Cyan
Remove-NetFirewallRule -DisplayName "Van System - Vite Server" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "Van System - WebSocket Server" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "Van System - RTSP Converter" -ErrorAction SilentlyContinue

Write-Host ""

# Allow Vite dev server (port 8090) - ALL NETWORKS
New-NetFirewallRule `
    -DisplayName "Van System - Vite Server" `
    -Direction Inbound `
    -LocalPort 8090 `
    -Protocol TCP `
    -Action Allow `
    -Profile Any `
    -ErrorAction SilentlyContinue
Write-Host "✓ Port 8090 (Vite Server) - Allowed for ALL networks" -ForegroundColor Green

# Allow WebSocket server (port 8091) - ALL NETWORKS
New-NetFirewallRule `
    -DisplayName "Van System - WebSocket Server" `
    -Direction Inbound `
    -LocalPort 8091 `
    -Protocol TCP `
    -Action Allow `
    -Profile Any `
    -ErrorAction SilentlyContinue
Write-Host "✓ Port 8091 (WebSocket Server) - Allowed for ALL networks" -ForegroundColor Green

# Allow RTSP converter (port 8092) - ALL NETWORKS
New-NetFirewallRule `
    -DisplayName "Van System - RTSP Converter" `
    -Direction Inbound `
    -LocalPort 8092 `
    -Protocol TCP `
    -Action Allow `
    -Profile Any `
    -ErrorAction SilentlyContinue
Write-Host "✓ Port 8092 (RTSP Converter) - Allowed for ALL networks" -ForegroundColor Green

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
