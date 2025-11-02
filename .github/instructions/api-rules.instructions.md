---
applyTo: '**'
---
---
alwaysApply: true

API Request Rules:
rule10: NEVER use hardcoded IPs or ports. ALWAYS use config_loader.get_config() for all URLs
rule11: ALL API endpoints must follow orchestrator proxy pattern: /{module_name}/{path}
rule12: Frontend requests ALWAYS go through orchestrator proxy, never direct to backend
rule13: Use GET for data retrieval, POST for actions/submissions, PUT for updates, DELETE for removal
rule14: All endpoints return JSONResponse with proper status codes (200 OK, 404 Not Found, 503 Service Unavailable, 500 Internal Server Error)
rule15: Backend modules register in orchestrator MODULES dict with host, port, and description
rule16: CORS origins must be loaded from config, include both config URL and localhost variants for dev
rule17: Health check endpoint required: /api/health returns JSON with status and service info
rule18: Input endpoints: /api/input (GET) returns current input data as JSON
rule19: Output endpoints: /api/output (GET) returns processing results as JSON
rule20: Status endpoints: /api/status (GET) returns processing state (idle/processing/completed)
rule21: Action endpoints: /api/run_* (POST) triggers processing, returns status immediately
rule22: Module-specific nested routes: /{module_name}/module{N}/output/{category} for categorized output
rule23: Error responses must include "error" key with human-readable message
rule24: Timeout for health checks: 2 seconds, for processing: 30 seconds minimum
rule25: All inter-service communication uses async httpx.AsyncClient with proper timeout
rule26: Frontend API calls use relative paths that next.config.js rewrites to orchestrator
rule27: Module ports: orchestrator 8000, module1 8001, module2 8002, module3 8003, etc
rule28: Configuration priority: 1) Environment variables (.env), 2) config.ini, 3) hardcoded defaults
rule29: Every module backend must load config on startup and use for host/port binding
rule30: Orchestrator proxy must preserve request method, headers, body when forwarding
---
