@echo off
echo.
echo Killing all Node.js processes...
taskkill /IM node.exe /F 2>nul
if errorlevel 1 (
    echo No Node.js processes were running.
) else (
    echo Done - all Node.js servers killed.
)
echo.
pause
