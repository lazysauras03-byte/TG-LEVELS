@echo off
cd /d "%~dp0"

echo.
echo ================================================
echo   EMA9 Signal Dashboard  (port 3299)
echo ================================================
echo.

echo [1/3] Stopping any previous server on port 3299...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3299 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo     Done.
echo.

echo [2/3] Checking required files...
if not exist "server.js"       ( echo ERROR: server.js not found       & pause & exit /b 1 )
if not exist "dashboard.html"  ( echo ERROR: dashboard.html not found  & pause & exit /b 1 )
if not exist ".env"            ( echo ERROR: .env not found            & pause & exit /b 1 )
echo     server.js       [OK]
echo     dashboard.html  [OK]
echo     .env            [OK]
echo.

echo [3/3] Starting EMA9 on port 3299...
echo     Local:   http://localhost:3299/chart
echo     Ngrok:   see below
echo.
echo ================================================
echo   Press Ctrl+C to stop
echo ================================================
echo.

node server.js

echo.
pause