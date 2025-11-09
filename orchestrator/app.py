"""FastAPI application for the IDK-AI orchestrator."""
from pathlib import Path
import logging
import sys

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import json

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR.parent))

logger = logging.getLogger(__name__)
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

try:
    from utils.env_loader import load_env_file

    env_path = ROOT_DIR.parent / ".env"
    if load_env_file(env_path):
        logger.info("Environment variables loaded from %s", env_path)
except (ImportError, ValueError):
    try:  # Fallback to python-dotenv when available
        from dotenv import load_dotenv

        env_path = ROOT_DIR.parent / ".env"
        load_dotenv(env_path)
        logger.info("Environment variables loaded via python-dotenv from %s", env_path)
    except ImportError:
        logger.info("Using system environment variables (python-dotenv not available)")

from config_loader import get_config


def _module_spec(name: str, default_port: int, description: str):
    connection = config.get_module_connection(name, default_port)
    connection["description"] = description
    return connection

config = get_config()

MODULES = {
    "module1": _module_spec("module1", 8001, "Link Verification & Scam Detection API"),
    "module2": _module_spec("module2", 8002, "Information Classification & Significance Scoring API"),
    "module3": _module_spec("module3", 8003, "Perspective Generation API"),
    "module4": _module_spec("module4", 8004, "Agent Debate & Analysis API"),
}

app = FastAPI(
    title="IDK-AI Orchestrator",
    description="API Gateway and Proxy for all backend modules",
    version="1.0.0"
)

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
                "base_url": mod_config["base_url"],
                "use_https": mod_config["use_https"],
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
            response = await client.get(f"{mod_config['base_url']}/api/health", timeout=2.0)
            if response.status_code == 200:
                return {
                    "success": True,
                    "message": f"Module '{module_name}' is running"
                }
    except Exception:  # Connectivity failure surfaces as 503 below
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

    query_string = request.url.query
    path_segment = path or ""
    base_url = mod_config.get("base_url")
    target_url = base_url
    if path_segment:
        target_url = f"{base_url}/{path_segment}"
    if query_string:
        target_url = f"{target_url}?{query_string}"

    body = await request.body()
    headers = dict(request.headers)
    headers["host"] = mod_config["host"]

    async with httpx.AsyncClient(timeout=httpx.Timeout(None)) as client:
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
        except Exception as exc:
            return JSONResponse(
                status_code=500,
                content={"error": "Proxy error", "details": str(exc)}
            )
