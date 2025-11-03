from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
import httpx
import json
from config_loader import get_config

# Load configuration
config = get_config()

# Module registry
MODULES = {
    "module1": {
        "host": config.get_module1_host(),
        "port": config.get_module1_port(),
        "description": "Link Verification & Scam Detection API"
    },
    "module2": {
        "host": config.get_module2_host(),
        "port": config.get_module2_port(),
        "description": "Information Classification & Significance Scoring API"
    },
    "module3": {
        "host": config.get_module3_host(),
        "port": config.get_module3_port(),
        "description": "Perspective Generation API"
    },
    "module4": {
        "host": config.get_module4_host(),
        "port": config.get_module4_port(),
        "description": "Agent Debate & Analysis API"
    }
}

app = FastAPI(
    title="IDK-AI Orchestrator",
    description="API Gateway and Proxy for all backend modules",
    version="1.0.0"
)

# Add CORS middleware to allow frontend direct access
frontend_url = config.get_frontend_url()
frontend_port = config.get_frontend_port()

allowed_origins = [
    frontend_url,
    f"http://localhost:{frontend_port}",
    f"http://127.0.0.1:{frontend_port}",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {
        "service": "IDK-AI Orchestrator",
        "version": "1.0.0",
        "modules": {
            name: {
                "host": mod_config["host"],
                "port": mod_config["port"],
                "description": mod_config["description"]
            }
            for name, mod_config in MODULES.items()
        }
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "IDK-AI Orchestrator",
        "registered_modules": list(MODULES.keys())
    }

@app.post("/run/{module_name}")
async def run_module(module_name: str):
    if module_name not in MODULES:
        return JSONResponse(
            status_code=404, 
            content={"success": False, "error": f"Unknown module '{module_name}'"}
        )
    
    mod_config = MODULES[module_name]
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"http://{mod_config['host']}:{mod_config['port']}/api/health",
                timeout=2.0
            )
            if response.status_code == 200:
                return {
                    "success": True, 
                    "message": f"Module '{module_name}' is running"
                }
    except:
        pass
    
    return JSONResponse(
        status_code=503, 
        content={"success": False, "error": f"Module '{module_name}' is not running"}
    )

@app.api_route("/{module_name}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_request(module_name: str, path: str, request: Request):
    if module_name not in MODULES:
        return JSONResponse(
            status_code=404, 
            content={"error": f"Unknown module '{module_name}'"}
        )

    mod_config = MODULES[module_name]
    
    # Use HTTPS for external Cloud Run services
    protocol = "https" if mod_config.get("use_https", False) else "http"
    port_suffix = "" if mod_config.get("use_https", False) else f":{mod_config['port']}"
    target_url = f"{protocol}://{mod_config['host']}{port_suffix}/{path}"

    body = await request.body()
    headers = dict(request.headers)
    headers["host"] = mod_config['host']

    timeout_config = httpx.Timeout(None)

    async with httpx.AsyncClient(timeout=timeout_config) as client:
        try:
            response = await client.request(
                method=request.method,
                url=target_url,
                content=body,
                headers=headers,
            )

            response_content = await response.aread()
            proxy_headers = dict(response.headers)
            proxy_headers.pop("content-encoding", None)
            proxy_headers.pop("content-length", None)
            proxy_headers.pop("transfer-encoding", None)

            if 'application/json' in response.headers.get('content-type', ''):
                content = json.loads(response_content.decode('utf-8')) if response_content else None
                return JSONResponse(
                    status_code=response.status_code,
                    content=content,
                    headers=proxy_headers,
                )
            else:
                return Response(
                    content=response_content,
                    status_code=response.status_code,
                    headers=proxy_headers,
                    media_type=response.headers.get('content-type', 'text/plain')
                )

        except httpx.ConnectError:
            return JSONResponse(
                status_code=503,
                content={"error": "Service unavailable", "details": f"Module '{module_name}' not reachable"}
            )
        except Exception as e:
            return JSONResponse(
                status_code=500,
                content={"error": "Proxy error", "details": str(e)}
            )


if __name__ == "__main__":
    import uvicorn
    
    orch_host = config.get_orchestrator_host()
    orch_port = config.get_orchestrator_port()
    
    print("=" * 70)
    print("🚀 IDK-AI Orchestrator (API Gateway)")
    print("=" * 70)
    print(f"Orchestrator running on: http://{orch_host}:{orch_port}")
    print(f"\nRegistered modules:")
    for name, mod_config in MODULES.items():
        print(f"  - {name}: {mod_config['host']}:{mod_config['port']} - {mod_config['description']}")
    print(f"\n  Start each module manually before use!")
    print("=" * 70)
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=orch_port,
        log_level="info"
    )
