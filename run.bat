@echo off
title QuickSave Clone Server
cd /d "%~dp0"
echo ========================================================
echo   Launching QuickSave Clone (100% Real-Time Working)
echo ========================================================
echo.
if exist "..\nodejs\node.exe" (
    set "PATH=%~dp0..\nodejs;%PATH%"
    "..\nodejs\node.exe" server.js
) else (
    node server.js
)
pause
