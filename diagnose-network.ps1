# Network Diagnostic Script for Van System
# This script helps diagnose why other devices cannot access the app

Write-Host "=== Van System Network Diagnostic ===" -ForegroundColor Cyan
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "⚠️  WARNING: Not running as Administrator" -ForegroundColor Yellow
    Write-Host "   Some checks may not work. Run as Admin for full diagnostics." -ForegroundColor Yellow
    Write-Host ""
}

# 1. Check server configuration
Write-Host "1. Checking Server Configuration..." -ForegroundColor Green
Write-Host "   - Vite config: Checking vite.config.js..."
if (Test-Path "vite.config.js") {
    $viteConfig = Get-Content "vite.config.js" -Raw
    if ($viteConfig -match "host:\s*['\`"]0\.0\.0\.0['\`"]") {
        Write-Host "   ✓ Vite is configured to listen on all interfaces (0.0.0.0)" -ForegroundColor Green
    } else {
        Write-Host "   ✗ Vite may not be configured for network access" -ForegroundColor Red
    }
} else {
    Write-Host "   ✗ vite.config.js not found" -ForegroundColor Red
}

# 2. Check if servers are running
Write-Host ""
Write-Host "2. Checking if servers are running..." -ForegroundColor Green
$ports = @(8090, 8091, 8092)
foreach ($port in $ports) {
    $listening = netstat -an | Select-String ":$port" | Select-String "LISTENING"
    if ($listening) {
        Write-Host "   ✓ Port $port is listening" -ForegroundColor Green
        # Check if it's listening on 0.0.0.0
        $onAllInterfaces = $listening | Select-String "0\.0\.0\.0:$port"
        if ($onAllInterfaces) {
            Write-Host "     → Listening on all interfaces (0.0.0.0)" -ForegroundColor Cyan
        } else {
            Write-Host "     → Listening on specific interface" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   ✗ Port $port is NOT listening" -ForegroundColor Red
        Write-Host "     → Server may not be running" -ForegroundColor Yellow
    }
}

# 3. Check Windows Firewall rules
Write-Host ""
Write-Host "3. Checking Windows Firewall Rules..." -ForegroundColor Green
if ($isAdmin) {
    $firewallRules = Get-NetFirewallRule -DisplayName "*Van System*" -ErrorAction SilentlyContinue
    if ($firewallRules) {
        Write-Host "   Found firewall rules:" -ForegroundColor Cyan
        foreach ($rule in $firewallRules) {
            $enabled = if ($rule.Enabled) { "Enabled" } else { "Disabled" }
            $action = $rule.Action
            $color = if ($rule.Enabled -and $rule.Action -eq "Allow") { "Green" } else { "Red" }
            Write-Host "   - $($rule.DisplayName): $enabled, Action: $action" -ForegroundColor $color
        }
    } else {
        Write-Host "   ✗ No Van System firewall rules found!" -ForegroundColor Red
        Write-Host "     → Run .\setup-firewall.ps1 as Administrator" -ForegroundColor Yellow
    }
    
    # Check each port specifically
    foreach ($port in $ports) {
        $rule = Get-NetFirewallRule | Where-Object {
            $_.DisplayName -like "*Van System*" -and
            ($_.LocalPort -eq $port -or (Get-NetFirewallPortFilter -AssociatedNetFirewallRule $_).LocalPort -eq $port) -and
            $_.Direction -eq "Inbound" -and
            $_.Action -eq "Allow"
        } | Select-Object -First 1
        
        if ($rule -and $rule.Enabled) {
            Write-Host "   ✓ Port $port is allowed in firewall" -ForegroundColor Green
        } else {
            Write-Host "   ✗ Port $port is NOT allowed in firewall" -ForegroundColor Red
        }
    }
} else {
    Write-Host "   ⚠️  Cannot check firewall (requires Administrator)" -ForegroundColor Yellow
    Write-Host "     → Run this script as Administrator to check firewall" -ForegroundColor Yellow
}

# 4. Get network IP addresses
Write-Host ""
Write-Host "4. Network IP Addresses..." -ForegroundColor Green
$networkInterfaces = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notlike "127.*" -and
    $_.IPAddress -notlike "169.254.*"
} | Sort-Object InterfaceIndex

if ($networkInterfaces) {
    Write-Host "   Available IP addresses for network access:" -ForegroundColor Cyan
    foreach ($interface in $networkInterfaces) {
        $adapter = Get-NetAdapter -InterfaceIndex $interface.InterfaceIndex -ErrorAction SilentlyContinue
        $adapterName = if ($adapter) { $adapter.Name } else { "Unknown" }
        Write-Host "   - $($interface.IPAddress) ($adapterName)" -ForegroundColor Cyan
        Write-Host "     → Access at: http://$($interface.IPAddress):8090" -ForegroundColor White
    }
} else {
    Write-Host "   ✗ No network interfaces found" -ForegroundColor Red
}

# 5. Test local connectivity
Write-Host ""
Write-Host "5. Testing Local Connectivity..." -ForegroundColor Green
foreach ($port in $ports) {
    try {
        $connection = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
        if ($connection.TcpTestSucceeded) {
            Write-Host "   ✓ Port $port is accessible locally" -ForegroundColor Green
        } else {
            Write-Host "   ✗ Port $port is NOT accessible locally" -ForegroundColor Red
        }
    } catch {
        Write-Host "   ⚠️  Could not test port $port" -ForegroundColor Yellow
    }
}

# 6. Recommendations
Write-Host ""
Write-Host "=== Recommendations ===" -ForegroundColor Cyan
Write-Host ""

$needsFirewall = $true
if ($isAdmin) {
    $firewallRules = Get-NetFirewallRule -DisplayName "*Van System*" -ErrorAction SilentlyContinue
    if ($firewallRules -and ($firewallRules | Where-Object { $_.Enabled -and $_.Action -eq "Allow" })) {
        $needsFirewall = $false
    }
}

if ($needsFirewall) {
    Write-Host "1. SETUP FIREWALL RULES:" -ForegroundColor Yellow
    Write-Host "   Run as Administrator: .\setup-firewall.ps1" -ForegroundColor White
    Write-Host ""
}

Write-Host "2. VERIFY SERVERS ARE RUNNING:" -ForegroundColor Yellow
Write-Host "   Run: npm run dev" -ForegroundColor White
Write-Host "   Check that all three servers start successfully" -ForegroundColor White
Write-Host ""

Write-Host "3. ACCESS FROM OTHER DEVICES:" -ForegroundColor Yellow
if ($networkInterfaces) {
    $firstIP = $networkInterfaces[0].IPAddress
    Write-Host "   Use one of these URLs on other devices:" -ForegroundColor White
    foreach ($interface in $networkInterfaces) {
        Write-Host "   → http://$($interface.IPAddress):8090" -ForegroundColor Cyan
    }
} else {
    Write-Host "   Find your IP address and use: http://[YOUR_IP]:8090" -ForegroundColor White
}
Write-Host ""

Write-Host "4. TROUBLESHOOTING:" -ForegroundColor Yellow
Write-Host "   - Ensure all devices are on the same network" -ForegroundColor White
Write-Host "   - Check Windows Firewall is not blocking (run setup-firewall.ps1)" -ForegroundColor White
Write-Host "   - Verify servers are running (npm run dev)" -ForegroundColor White
Write-Host "   - Try accessing from the same PC first: http://localhost:8090" -ForegroundColor White
Write-Host ""

Write-Host "=== Diagnostic Complete ===" -ForegroundColor Cyan

