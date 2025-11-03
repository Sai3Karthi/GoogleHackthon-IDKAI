@echo off
echo Starting Module 4 Backend (Agent Debate)...
echo.

cd module4\backend

echo Checking Python environment...
python --version
echo.

echo Starting Module 4 server...
echo Server will run on http://127.0.0.1:8004
echo Press Ctrl+C to stop
echo.

python main.py

pause
