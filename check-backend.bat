@echo off
echo ===================================
echo Backend Diagnostic Tool
echo ===================================
echo.

echo 1. Checking Python installation...
python --version
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH!
    pause
    exit /b 1
)
echo OK - Python found
echo.

echo 2. Checking if port 8002 is available...
netstat -ano | findstr :8002
if %errorlevel% equ 0 (
    echo WARNING: Port 8002 is in use!
    echo Run kill-backend.bat to fix this.
) else (
    echo OK - Port 8002 is available
)
echo.

echo 3. Checking backend directory...
if not exist "module3\backend\main.py" (
    echo ERROR: Backend directory not found!
    pause
    exit /b 1
)
echo OK - Backend directory exists
echo.

echo 4. Checking .env file...
if not exist ".env" (
    echo WARNING: .env file not found in root directory!
    echo The backend needs VERTEX_ENDPOINT configured.
) else (
    echo OK - .env file exists
    findstr VERTEX_ENDPOINT .env
)
echo.

echo 5. Trying to start backend manually...
echo Press Ctrl+C to stop, or close this window
echo.
cd module3\backend
python main.py

