@echo off
setlocal

cd /d "%~dp0"
echo Restarting Van System services...
echo.

call "%~dp0stop-app.bat"
echo.
echo Starting services again...
echo.
npm run dev

endlocal
