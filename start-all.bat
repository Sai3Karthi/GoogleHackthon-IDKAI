@echo off
echo ================================================
echo IDK-AI Complete Startup
echo ================================================
echo.
echo This will start all components in separate windows:
echo   1. Orchestrator (Port 8000)
echo   2. Module3 Backend (Port 8002)
echo   3. Frontend (Port 3000)
echo.
echo Press any key to continue...
pause > nul

start "Orchestrator" cmd /k "python orchestrator.py"
timeout /t 3 /nobreak > nul

start "Module3 Backend" cmd /k "cd module3\backend && python main.py"
timeout /t 5 /nobreak > nul

start "Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ================================================
echo All components started!
echo ================================================
echo.
echo Orchestrator:  http://localhost:8000
echo Module3:       http://localhost:8002
echo Frontend:      http://localhost:3000
echo.
pause
