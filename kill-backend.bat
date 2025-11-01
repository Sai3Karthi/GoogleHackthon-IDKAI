@echo off
echo Killing backend process on port 8002...
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr :8002') DO (
    echo Found process: %%T
    taskkill /F /PID %%T
)
echo Done!
pause

