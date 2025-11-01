@echo off
echo ====================================
echo Restarting Backend
echo ====================================

echo.
echo Step 1: Killing existing backend processes...
call kill-backend.bat

echo.
echo Step 2: Verifying port 8002 is free...
netstat -ano | findstr :8002 >nul
if %errorlevel% equ 0 (
    echo WARNING: Port 8002 is still in use!
    echo Please close all Python processes manually or restart your computer.
    pause
    exit /b 1
) else (
    echo SUCCESS: Port 8002 is available
)

echo.
echo Step 3: Starting backend on port 8002...
cd module3\backend
start "Backend Server" cmd /k "set PIPELINE_PORT=8002 && set PYTHONIOENCODING=utf-8 && set PYTHONUNBUFFERED=1 && python main.py"

echo.
echo ====================================
echo Backend restarting in new window...
echo ====================================
echo.
echo Wait 5 seconds, then refresh your browser page!
echo.
pause

