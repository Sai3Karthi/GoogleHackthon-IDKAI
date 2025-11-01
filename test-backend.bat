@echo off
echo ===================================
echo Testing Backend Startup
echo ===================================
echo.

echo [1/4] Checking Python installation...
python --version
if errorlevel 1 (
    echo ERROR: Python not found in PATH
    echo Please install Python and add it to PATH
    pause
    exit /b 1
)
echo OK: Python found
echo.

echo [2/4] Checking backend directory...
if not exist "module3\backend\main.py" (
    echo ERROR: main.py not found at module3\backend\main.py
    pause
    exit /b 1
)
echo OK: Backend files found
echo.

echo [3/4] Killing any existing processes on port 8002...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8002 ^| findstr LISTENING') do (
    echo Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 >nul
echo OK: Port cleared
echo.

echo [4/4] Starting backend...
echo Press Ctrl+C to stop
echo.
cd module3\backend
set PIPELINE_PORT=8002
python main.py

pause

