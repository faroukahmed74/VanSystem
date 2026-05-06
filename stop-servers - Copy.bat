@echo off
setlocal

cd /d "%~dp0"
echo Stopping Van System services on ports 8090, 8091, 8092...
powershell -ExecutionPolicy Bypass -File "%~dp0stop-servers.ps1"
echo.
echo Ports cleared. You can now run: npm run dev

endlocal

