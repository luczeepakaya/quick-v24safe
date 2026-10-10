@echo off
title LUKZI VS SOCIAL MEDIA - Local Server
cd /d "%~dp0"
echo ========================================================
echo   LUKZI VS SOCIAL MEDIA 🇱🇰
echo   Starting Local Server on http://localhost:3000
echo ========================================================
echo.

start http://localhost:3000

if exist "..\nodejs\node.exe" (
    set "PATH=%~dp0..\nodejs;%PATH%"
    "..\nodejs\node.exe" server.js
) else (
    node server.js
)
pause
