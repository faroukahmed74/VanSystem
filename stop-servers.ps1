# Script to stop all servers on ports 8090, 8091, 8092
Write-Host "Stopping servers on ports 8090, 8091, 8092..."

$ports = @(8090, 8091, 8092)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.OwningProcess) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped process on port $port (PID: $($conn.OwningProcess))"
        }
    }
}

Write-Host "Ports cleared. You can now run: npm run dev"

