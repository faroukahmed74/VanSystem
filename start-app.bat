@echo off
setlocal

cd /d "%~dp0"
echo Starting Van System services...
echo Running: npm run dev
echo.

npm run dev

endlocal
