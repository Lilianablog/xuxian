@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:4317/' | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "Xuxian local service - close to stop" cmd.exe /k "cd /d ""%~dp0"" && npm.cmd run dev"
  timeout /t 6 /nobreak >nul
)
start "" "http://localhost:4317/"
