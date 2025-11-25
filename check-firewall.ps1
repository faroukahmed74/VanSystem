# PowerShell script to check Windows Firewall rules for Van System
# Run this script as Administrator to check firewall status

Write-Host "Checking Windows Firewall rules for Van System..." -ForegroundColor Cyan
Write-Host ""

$ports = @(
    @{Port=8090; Name="Vite Server"},
    @{Port=8091; Name="WebSocket Server"},
    @{Port=8092; Name="RTSP Converter"}
)

$allConfigured = $true

foreach ($portInfo in $ports) {
    $port = $portInfo.Port
    $name = $portInfo.Name
    
    try {
        $rule = Get-NetFirewallRule -DisplayName "*Van System*" -ErrorAction SilentlyContinue | 
                Where-Object { $_.DisplayName -like "*$name*" -or $_.DisplayName -like "*$port*" }
        
        if ($rule) {
            $enabled = ($rule | Where-Object { $_.Enabled -eq $true })
            if ($enabled) {
                Write-Host "[OK] Port $port ($name) - Firewall rule exists and is ENABLED" -ForegroundColor Green
            } else {
                Write-Host "[WARN] Port $port ($name) - Firewall rule exists but is DISABLED" -ForegroundColor Yellow
                $allConfigured = $false
            }
        } else {
            Write-Host "[MISSING] Port $port ($name) - No firewall rule found" -ForegroundColor Red
            $allConfigured = $false
        }
    } catch {
        Write-Host "[ERROR] Could not check port $port - Run as Administrator" -ForegroundColor Red
        $allConfigured = $false
    }
}

Write-Host ""
if ($allConfigured) {
    Write-Host "All firewall rules are configured correctly!" -ForegroundColor Green
} else {
    Write-Host "Some firewall rules are missing or disabled." -ForegroundColor Yellow
    Write-Host "Run setup-firewall.ps1 as Administrator to configure them." -ForegroundColor Cyan
}

