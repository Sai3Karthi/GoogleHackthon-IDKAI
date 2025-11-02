@echo off
echo ================================================
echo IDK-AI Complete Startup
echo ================================================
echo.
echo This will start all components in separate windows:
echo   1. Orchestrator (Port 8000)
echo   2. Module1 Backend (Port 8001)
echo   3. Module2 Backend (Port 8002)
echo   4. Module3 Backend (Port 8003)
echo   5. Frontend (Port 3001)
echo.
echo Press any key to continue...
pause > nul

start "Orchestrator" cmd /k "python orchestrator.py"
timeout /t 3 /nobreak > nul

start "Module1 Backend" cmd /k "cd module1\backend && python main.py"
timeout /t 2 /nobreak > nul

start "Module2 Backend" cmd /k "cd module2\backend && python main.py"
timeout /t 2 /nobreak > nul

start "Module3 Backend" cmd /k "cd module3\backend && python main.py"
timeout /t 3 /nobreak > nul

start "Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ================================================
echo All components started!
echo ================================================
echo.
echo Orchestrator:  http://localhost:8000
echo Module1:       http://localhost:8001
echo Module2:       http://localhost:8002
echo Module3:       http://localhost:8003
echo Frontend:      http://localhost:3001
echo.
pause
