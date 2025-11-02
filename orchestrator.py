from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
import httpx
import json

# Module registry
MODULES = {
    "module3": {
        "port": 8002,
        "description": "Perspective Generation API"
    }
}

app = FastAPI(
    title="IDK-AI Orchestrator",
    description="API Gateway and Proxy for all backend modules",
    version="1.0.0"
)

@app.get("/")
async def root():
    return {
        "service": "IDK-AI Orchestrator",
        "version": "1.0.0",
        "modules": {
            name: {
                "port": config["port"],
                "description": config["description"]
            }
            for name, config in MODULES.items()
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
    
    config = MODULES[module_name]
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"http://127.0.0.1:{config['port']}/api/health",
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

    config = MODULES[module_name]
    target_url = f"http://127.0.0.1:{config['port']}/{path}"

    body = await request.body()
    headers = dict(request.headers)
    headers["host"] = f"127.0.0.1:{config['port']}"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.request(
                method=request.method,
                url=target_url,
                content=body,
                headers=headers,
                timeout=30.0,
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
    
    print("=" * 70)
    print("🚀 IDK-AI Orchestrator (API Gateway)")
    print("=" * 70)
    print(f"Orchestrator running on: http://127.0.0.1:8000")
    print(f"\nRegistered modules:")
    for name, config in MODULES.items():
        print(f"  - {name}: port {config['port']} - {config['description']}")
    print(f"\n⚠️  Start each module manually before use!")
    print("=" * 70)
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
