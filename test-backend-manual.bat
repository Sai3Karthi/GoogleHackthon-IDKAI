@echo off
echo ============================================
echo Testing Backend Startup
echo ============================================
echo.
echo Current directory: %CD%
echo.
cd module3\backend
echo Changed to: %CD%
echo.
echo Starting Python backend...
echo.
python main.py
pause

