# Quick Startup Guide

## The Problem You Had
The frontend was trying to auto-start the backend through the orchestrator, but the orchestrator is just a proxy, not a process manager. This caused the 503 error.

## The Solution
Manual startup using batch files. Here's the correct order:

## Step-by-Step Startup

### Option 1: Start Everything at Once
```bash
./start-all.bat
```
This opens 3 terminal windows:
1. Orchestrator (port 8000)
2. Module3 Backend (port 8002)
3. Frontend (port 3000)

Wait for all to finish starting, then visit: http://localhost:3000/modules/3

### Option 2: Start Individually

**1. Start Orchestrator** (ALWAYS FIRST)
```bash
./start-orchestrator.bat
```
Wait until you see: `Uvicorn running on http://0.0.0.0:8000`

**2. Start Module3 Backend**
```bash
./start-module3.bat
```
Wait until you see: `Uvicorn running on http://127.0.0.1:8001`

**3. Start Frontend**
```bash
./start-frontend.bat
```
Wait for: `Ready in X seconds`

**4. Open Browser**
Navigate to: http://localhost:3000/modules/3

## Using the UI

### When Backend is Not Running
- You'll see: "Backend: Not Running" (red dot)
- Button shows: "Refresh Status"
- Message: "Run start-module3.bat to start the backend"

### After Starting Backend
1. Click "Refresh Status" button
2. Status should change to "Backend: Running" (green dot)
3. New button appears: "Begin Generation"
4. Click "Begin Generation" to start perspective generation

### The Flow
```
Start Backend → Refresh Status → Begin Generation → Watch Magic Happen
```

## What Changed in the Code

### Before (Broken)
- Frontend tried to POST to `/run/module3` to start backend
- Orchestrator returned 503 because it can't start processes
- User was sad 😢

### After (Fixed)
- Frontend just checks if backend is healthy via `/module3/api/health`
- User manually starts backend using `start-module3.bat`
- Frontend detects it's running and enables generation
- User is happy 😊

## Troubleshooting

### "Backend: Not Running" even though you started it
**Fix:** Click "Refresh Status" button

### 503 Error
**Cause:** Backend not started or crashed
**Fix:** Check the Module3 terminal window for errors, restart if needed

### Port Already in Use
**Cause:** Previous instance still running
**Fix:** 
```bash
# On Windows PowerShell
Get-Process -Name python | Stop-Process -Force
Get-Process -Name node | Stop-Process -Force
```
Then restart using batch files

### Input Data Not Loading
**Cause:** Backend not running or orchestrator not proxying
**Fix:** 
1. Ensure orchestrator is running (http://localhost:8000/health)
2. Ensure module3 is running (http://localhost:8002/api/health)
3. Click "Refresh Status"

## Architecture Overview

```
Frontend (3000)
    ↓ (all API calls)
Orchestrator (8000) [API Gateway/Proxy]
    ↓ (proxies to)
Module3 Backend (8002)
```

All data flows through the orchestrator for deployment flexibility.

## Development Tips

### Restart Just the Frontend
```bash
# In frontend terminal: Ctrl+C
npm run dev
```

### Restart Just Module3
```bash
# In module3 terminal: Ctrl+C
python main.py
```

### Check What's Running
```bash
# PowerShell
Get-Process | Where-Object {$_.ProcessName -match "python|node"}
```

### View Logs
- **Orchestrator**: Check the terminal window labeled "Orchestrator"
- **Module3**: Check the terminal window labeled "Module3 Backend"
- **Frontend**: Check the terminal window labeled "next-server"

## Quick Reference

| Service | Port | Health Check | Purpose |
|---------|------|--------------|---------|
| Frontend | 3000 | http://localhost:3000 | Next.js UI |
| Orchestrator | 8000 | http://localhost:8000/health | API Gateway |
| Module3 | 8002 | http://localhost:8002/api/health | Perspective Generation |

## Happy Path

1. Run `./start-all.bat`
2. Wait 30 seconds for everything to start
3. Open http://localhost:3000/modules/3
4. Click "Refresh Status" (if needed)
5. Click "Begin Generation"
6. Watch perspectives generate in real-time
7. See beautiful visualizations
8. Export to JSON for Module 4

You're all set! 🚀
