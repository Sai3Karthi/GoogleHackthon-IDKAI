@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Backend Pre-Flight Check
echo ========================================
echo.

set "errors=0"
set "warnings=0"

REM Check 1: Python Installation
echo [1/7] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "pyver=%%v"
    echo   ✓ Python found: !pyver!
) else (
    echo   ✗ ERROR: Python not found in PATH
    set /a errors+=1
)
echo.

REM Check 2: Port Availability
echo [2/7] Checking port 8002 availability...
netstat -ano | findstr :8002 >nul 2>&1
if %errorlevel% equ 0 (
    echo   ⚠ WARNING: Port 8002 is in use
    echo   Run kill-backend.bat to fix this
    set /a warnings+=1
    netstat -ano | findstr :8002
) else (
    echo   ✓ Port 8002 is available
)
echo.

REM Check 3: Backend Directory
echo [3/7] Checking backend directory...
if exist "module3\backend\main.py" (
    echo   ✓ Backend directory exists
    echo   ✓ main.py found
) else (
    echo   ✗ ERROR: Backend directory or main.py not found
    set /a errors+=1
)
echo.

REM Check 4: Environment File
echo [4/7] Checking environment configuration...
if exist ".env" (
    echo   ✓ .env file exists
    findstr /C:"VERTEX_ENDPOINT" .env >nul 2>&1
    if %errorlevel% equ 0 (
        echo   ✓ VERTEX_ENDPOINT configured
    ) else (
        echo   ⚠ WARNING: VERTEX_ENDPOINT not found in .env
        set /a warnings+=1
    )
) else (
    echo   ⚠ WARNING: .env file not found
    echo   Create .env with VERTEX_ENDPOINT configuration
    set /a warnings+=1
)
echo.

REM Check 5: Python Dependencies
echo [5/7] Checking Python dependencies...
python -c "import fastapi" >nul 2>&1
if %errorlevel% equ 0 (
    echo   ✓ fastapi installed
) else (
    echo   ✗ ERROR: fastapi not installed
    echo   Run: pip install -r module3\requirements.txt
    set /a errors+=1
)

python -c "import uvicorn" >nul 2>&1
if %errorlevel% equ 0 (
    echo   ✓ uvicorn installed
) else (
    echo   ✗ ERROR: uvicorn not installed
    set /a errors+=1
)

python -c "import google.genai" >nul 2>&1
if %errorlevel% equ 0 (
    echo   ✓ google-genai installed
) else (
    echo   ⚠ WARNING: google-genai not installed (may not be needed for cached results)
    set /a warnings+=1
)
echo.

REM Check 6: Google Cloud Authentication
echo [6/7] Checking Google Cloud authentication...
gcloud auth application-default print-access-token >nul 2>&1
if %errorlevel% equ 0 (
    echo   ✓ Google Cloud credentials configured
) else (
    echo   ⚠ WARNING: Google Cloud credentials not configured
    echo   Run: gcloud auth application-default login
    echo   (Only needed for generating new perspectives)
    set /a warnings+=1
)
echo.

REM Check 7: Frontend
echo [7/7] Checking frontend setup...
if exist "frontend\package.json" (
    echo   ✓ Frontend directory exists
    if exist "frontend\node_modules" (
        echo   ✓ node_modules found
    ) else (
        echo   ⚠ WARNING: node_modules not found
        echo   Run: cd frontend ^&^& npm install
        set /a warnings+=1
    )
) else (
    echo   ✗ ERROR: Frontend directory not found
    set /a errors+=1
)
echo.

REM Summary
echo ========================================
echo Pre-Flight Check Complete
echo ========================================
echo.

if !errors! equ 0 (
    if !warnings! equ 0 (
        echo ✓✓✓ ALL CHECKS PASSED ✓✓✓
        echo.
        echo Your system is ready to run the backend!
        echo Click "Start Backend" in the UI to begin.
    ) else (
        echo ⚠ !warnings! warning(s) found
        echo.
        echo The backend should work, but you may encounter issues.
        echo Review the warnings above and fix them if possible.
    )
) else (
    echo ✗✗✗ !errors! error(s) found ✗✗✗
    echo.
    echo Please fix the errors above before starting the backend.
    echo.
    if !errors! gtr 0 (
        echo Common fixes:
        echo - Install Python from python.org
        echo - Run: pip install -r module3\requirements.txt
        echo - Run: gcloud auth application-default login
        echo - Create .env file with VERTEX_ENDPOINT
    )
)

echo.
echo Press any key to exit...
pause >nul
