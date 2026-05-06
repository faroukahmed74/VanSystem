# PowerShell script to check Windows Firewall rules for Van System
# Run this script as Administrator to check firewall status

Write-Host "Checking Windows Firewall rules for Van System..." -ForegroundColor Cyan
Write-Host ""

$rules = @(
    @{ Port = 8090; Name = "Vite Server"; RuleName = "Van System - Vite Server" },
    @{ Port = 8091; Name = "WebSocket Server"; RuleName = "Van System - WebSocket Server" },
    @{ Port = 8092; Name = "RTSP Converter"; RuleName = "Van System - RTSP Converter" }
)

$allConfigured = $true

foreach ($entry in $rules) {
    try {
        $rule = Get-NetFirewallRule -DisplayName $entry.RuleName -ErrorAction SilentlyContinue
        if (-not $rule) {
            Write-Host ("[MISSING] Port {0} ({1}) - No firewall rule found" -f $entry.Port, $entry.Name) -ForegroundColor Red
            $allConfigured = $false
            continue
        }

        $ruleEnabled = $false
        foreach ($r in @($rule)) {
            if ("$($r.Enabled)" -eq "True") {
                $ruleEnabled = $true
                break
            }
        }

        if ($ruleEnabled) {
            Write-Host ("[OK] Port {0} ({1}) - Firewall rule exists and is ENABLED" -f $entry.Port, $entry.Name) -ForegroundColor Green
        } else {
            Write-Host ("[WARN] Port {0} ({1}) - Firewall rule exists but is DISABLED" -f $entry.Port, $entry.Name) -ForegroundColor Yellow
            $allConfigured = $false
        }
    } catch {
        Write-Host ("[ERROR] Could not check port {0} - Run as Administrator" -f $entry.Port) -ForegroundColor Red
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
