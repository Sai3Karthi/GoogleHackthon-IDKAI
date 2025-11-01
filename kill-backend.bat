@echo off
echo ====================================
echo Killing Backend Processes
echo ====================================
echo.

echo Step 1: Killing processes on port 8002...
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr :8002 2^>nul') DO (
    echo   Found process on port 8002: PID %%T
    taskkill /F /PID %%T 2>nul
)

echo.
echo Step 2: Additional cleanup (if needed)...
echo   Port-based cleanup is usually sufficient

echo.
echo Step 3: Waiting for processes to terminate...
timeout /t 2 /nobreak >nul

echo.
echo ====================================
echo Backend cleanup complete!
echo ====================================
echo.
echo Port 8002 should now be available.
echo You can now click "Start Backend" in the UI.
echo.
pause

