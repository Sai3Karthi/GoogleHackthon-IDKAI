# API Request Patterns and Standards

## Architecture Overview

```
Frontend (Port 3000)
    |
    | All requests go through Next.js rewrites
    |
    v
Orchestrator (Port 8000) - API Gateway
    |
    | Proxy pattern: /{module_name}/{path}
    |
    v
Module Backends (Ports 8001, 8002, 8003...)
```

## Core Principles

1. **No Direct Backend Calls**: Frontend NEVER calls backend directly
2. **Orchestrator Proxy**: All requests route through orchestrator
3. **Config-Driven**: All hosts/ports from config.ini
4. **RESTful Verbs**: GET for reads, POST for actions, PUT for updates, DELETE for removal
5. **Consistent Response Format**: Always JSON with proper status codes

## Port Allocation

| Service | Port | Config Section |
|---------|------|----------------|
| Orchestrator | 8000 | [orchestrator] |
| Module1 | 8001 | [module1] |
| Module2 | 8002 | [module2] |
| Module3 | 8003 | [module3] |
| Module4 | 8004 | [module4] |

Note: Module3 currently uses 8002, adjust config.ini for consistency

## Standard Endpoints (All Modules Must Implement)

### Health Check
```
GET /api/health
```
**Purpose**: Verify service is running
**Response**:
```json
{
  "status": "healthy",
  "service": "Module1 Service",
  "version": "1.0.0",
  "backend_version": "1.0.0"
}
```
**Status Codes**: 200 OK

### Input Data
```
GET /api/input
```
**Purpose**: Get current input data for the module
**Response**:
```json
{
  "topic": "...",
  "text": "...",
  "significance_score": 0.75
}
```
**Status Codes**: 200 OK, 404 Not Found

### Output Data
```
GET /api/output
```
**Purpose**: Get processed output data
**Response**:
```json
{
  "result": "...",
  "data": []
}
```
**Status Codes**: 200 OK, 404 Not Found, 500 Internal Server Error

### Processing Status
```
GET /api/status
```
**Purpose**: Check if module is currently processing
**Response**:
```json
{
  "status": "idle",
  "progress": 0,
  "pipeline_complete": false
}
```
**Status Values**: "idle", "processing", "completed", "error"
**Status Codes**: 200 OK

### Start Processing
```
POST /api/run_pipeline
```
**Purpose**: Trigger module processing
**Request Body**: Optional, depends on module
**Response**:
```json
{
  "status": "started",
  "message": "Pipeline started in background"
}
```
**Status Codes**: 200 OK, 503 Service Unavailable

## Frontend Request Pattern

### Configuration
In `next.config.js`:
```javascript
const { loadConfig } = require('./config-loader');
const config = loadConfig();
const orchestratorUrl = `http://${config.orchestratorHost}:${config.orchestratorPort}`;

async rewrites() {
  return [
    {
      source: '/module1/:path*',
      destination: `${orchestratorUrl}/module1/:path*`,
    },
    {
      source: '/module2/:path*',
      destination: `${orchestratorUrl}/module2/:path*`,
    },
  ]
}
```

### Frontend API Calls
```typescript
// CORRECT - Relative path through orchestrator
const response = await fetch('/module1/api/health');
const response = await fetch('/module1/api/input');
const response = await fetch('/module1/api/run_pipeline', { method: 'POST' });

// WRONG - Never hardcode backend URLs
const response = await fetch('http://localhost:8001/api/health'); // ❌ NO
```

## Backend Module Structure

### Required Imports
```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from config_loader import get_config

# Load configuration
config = get_config()
```

### FastAPI App Setup
```python
app = FastAPI(
    title="Module1 Service",
    version="1.0.0",
    description="Description of module functionality"
)

# CORS Configuration from config
allowed_origins = []
if config:
    frontend_url = config.get_frontend_url()
    allowed_origins.append(frontend_url)
    frontend_port = config.get_frontend_port()
    allowed_origins.extend([
        f"http://localhost:{frontend_port}",
        f"http://127.0.0.1:{frontend_port}"
    ])
else:
    allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Server Startup
```python
if __name__ == "__main__":
    import uvicorn
    
    if config:
        host = config.get_module1_host()
        port = config.get_module1_port()
    else:
        host = "127.0.0.1"
        port = int(os.getenv("MODULE1_PORT", 8001))
    
    logger.info(f"Starting Module1 server on {host}:{port}")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )
```

## Orchestrator Module Registration

### Adding New Module
In `orchestrator.py`:
```python
from config_loader import get_config
config = get_config()

MODULES = {
    "module1": {
        "host": config.get_module1_host(),
        "port": config.get_module1_port(),
        "description": "Module 1 Service Description"
    },
    "module2": {
        "host": config.get_module2_host(),
        "port": config.get_module2_port(),
        "description": "Module 2 Service Description"
    },
}
```

### Config Loader Updates
In `config_loader.py`, add methods:
```python
def get_module1_url(self):
    host = self.config.get('module1', 'host', fallback='127.0.0.1')
    port = self.config.getint('module1', 'port', fallback=8001)
    return f"http://{host}:{port}"

def get_module1_host(self):
    return self.config.get('module1', 'host', fallback='127.0.0.1')

def get_module1_port(self):
    return self.config.getint('module1', 'port', fallback=8001)
```

## Error Handling Standards

### Success Response
```json
{
  "status": "success",
  "data": { ... }
}
```

### Error Response
```json
{
  "error": "Human-readable error message",
  "details": "Technical details (optional)",
  "status": "error"
}
```

### Status Codes
- **200 OK**: Successful GET/POST
- **404 Not Found**: Resource doesn't exist
- **500 Internal Server Error**: Server-side error
- **503 Service Unavailable**: Service not running/reachable

### Exception Handling
```python
@app.get("/api/data")
async def get_data():
    try:
        data = load_data()
        return JSONResponse({"data": data})
    except FileNotFoundError:
        return JSONResponse(
            {"error": "Data file not found"},
            status_code=404
        )
    except Exception as e:
        logger.error(f"Error loading data: {e}")
        return JSONResponse(
            {"error": "Internal server error", "details": str(e)},
            status_code=500
        )
```

## Inter-Service Communication

### Backend to Backend
```python
import httpx
from config_loader import get_config

config = get_config()

async def call_module2():
    module2_url = config.get_module2_url()
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{module2_url}/api/data",
                timeout=30.0
            )
            if response.status_code == 200:
                return response.json()
        except httpx.ConnectError:
            logger.error("Module2 not reachable")
            return None
```

### Frontend to Backend (via Orchestrator)
```typescript
// Component
const fetchData = async () => {
  try {
    const response = await fetch('/module1/api/data');
    if (response.ok) {
      const data = await response.json();
      setData(data);
    } else {
      console.error('Failed to fetch data');
    }
  } catch (error) {
    console.error('Error:', error);
  }
};
```

## Testing Endpoints

### Using curl
```bash
# Health check
curl http://localhost:8000/module1/api/health

# Get input
curl http://localhost:8000/module1/api/input

# Start processing
curl -X POST http://localhost:8000/module1/api/run_pipeline

# Check status
curl http://localhost:8000/module1/api/status
```

### Using Python
```python
import requests

# Health check
response = requests.get('http://localhost:8000/module1/api/health')
print(response.json())

# Start processing
response = requests.post('http://localhost:8000/module1/api/run_pipeline')
print(response.json())
```

## Batch File for New Module

### start-module1.bat
```batch
@echo off
echo Starting Module1 Backend...
cd module1\backend
python main.py
```

### Update start-all.bat
```batch
@echo off
echo Starting all services...

start cmd /k "title Orchestrator && cd /d %~dp0 && call start-orchestrator.bat"
timeout /t 3 /nobreak >nul

start cmd /k "title Module1 Backend && cd /d %~dp0 && call start-module1.bat"
timeout /t 3 /nobreak >nul

start cmd /k "title Module2 Backend && cd /d %~dp0 && call start-module2.bat"
timeout /t 3 /nobreak >nul

start cmd /k "title Frontend && cd /d %~dp0 && call start-frontend.bat"
```

## Configuration for New Module

### config.ini
```ini
[module1]
host = 127.0.0.1
port = 8001

[module2]
host = 127.0.0.1
port = 8002
```

### Environment Variables (.env)
```bash
MODULE1_PORT=8001
MODULE2_PORT=8002
```

## Checklist for Adding New Module

- [ ] Create module folder structure: `module{N}/backend/`
- [ ] Implement main.py with FastAPI app
- [ ] Add required endpoints: /api/health, /api/input, /api/output, /api/status
- [ ] Load config using config_loader.get_config()
- [ ] Configure CORS from config
- [ ] Use config for host/port in uvicorn.run()
- [ ] Add module to orchestrator MODULES dict
- [ ] Add module methods to config_loader.py
- [ ] Add module section to config.ini
- [ ] Update next.config.js rewrites
- [ ] Create start-module{N}.bat file
- [ ] Update start-all.bat
- [ ] Test all endpoints through orchestrator
- [ ] Verify frontend can access via proxy

## Quick Reference

### GET Endpoints
- Data retrieval only
- No side effects
- Idempotent (same result every call)
- Examples: /api/health, /api/input, /api/output, /api/status

### POST Endpoints  
- Trigger actions
- May have side effects
- Start processes
- Examples: /api/run_pipeline, /api/process, /api/generate

### PUT Endpoints
- Update existing resources
- Idempotent
- Examples: /api/update_config, /api/update_input

### DELETE Endpoints
- Remove resources
- Examples: /api/clear_cache, /api/reset

Follow these patterns for consistent, maintainable, and deployment-ready code.
