@echo off
echo ====================================
echo Restarting Backend with New CORS...
echo ====================================

echo.
echo Step 1: Killing existing backend processes...
taskkill /F /IM python.exe 2>nul
if %errorlevel% equ 0 (
    echo SUCCESS: Killed existing Python processes
) else (
    echo No Python processes found
)

echo.
echo Step 2: Waiting for port to be released...
timeout /t 2 /nobreak >nul

echo.
echo Step 3: Starting backend on port 8002...
cd module3\backend
start "Backend Server" cmd /k "python main.py"

echo.
echo ====================================
echo Backend restarting in new window...
echo ====================================
echo.
echo Wait 5 seconds, then refresh your browser page!
echo.
pause

