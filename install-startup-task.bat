@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-startup-task.ps1"
echo.
echo This window will stay open so you can read any message above.
pause
