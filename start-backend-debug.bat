@echo off
echo =============================================
echo Debug: Starting Backend Manually
echo =============================================
echo.

cd module3\backend

echo Setting environment...
set PIPELINE_PORT=8002
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1

echo.
echo Starting backend on port 8002...
echo.

python main.py

echo.
echo Backend stopped.
pause

