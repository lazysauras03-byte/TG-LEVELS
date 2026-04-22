@echo off
cd /d "%~dp0"

echo.
echo ================================================
echo   EMA9 Signal Dashboard  (port 3201)
echo ================================================
echo.

echo [1/3] Stopping previous EMA9 server...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq EMA9*" >nul 2>&1

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3201 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo     Done.
echo.

echo [2/3] Checking files...
if not exist "server.js" ( echo ERROR: server.js not found & pause & exit /b 1 )
if not exist "dashboard.html" ( echo ERROR: dashboard.html not found & pause & exit /b 1 )
echo     server.js       [OK]
echo     dashboard.html  [OK]
echo.

echo [3/3] Starting EMA9 on port 3201...
echo     Local:   http://localhost:3201
echo     Ngrok:   see below
echo     Other apps on 3200 are NOT affected
echo.
echo ================================================
echo   Press Ctrl+C to stop
echo ================================================
echo.

node server.js

echo.
pause