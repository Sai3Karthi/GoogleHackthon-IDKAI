# IDK-AI: AI-Powered Information Verification Pipeline

## Architecture Overview

IDK-AI is a multi-stage AI verification system that analyzes text, URLs, and images for scams, misinformation, and fake content through a sequential modular pipeline with intelligent skip logic.

### Service Architecture
```
Frontend (Next.js:3000) → Orchestrator (FastAPI:8000) → Modules (FastAPI:8001-8004)
```

**Core Principle**: Frontend NEVER calls backend modules directly. ALL requests route through the orchestrator proxy at `/{module_name}/{path}`.

### Module Pipeline Flow

```
Module 1 (8001): Scam Detection & Risk Analysis
    ↓ (skip logic: confidence >= 85% → skip to Module 5)
    ↓
Module 2 (8002): Classification & Significance Scoring
    ↓ (inverse relationship: lower confidence = higher significance)
    ↓
Module 3 (8003): Perspective Generation (Leftist/Rightist/Common)
    ↓
Module 4 (8004): AI Agent Debate & Trust Scoring
    ↓
Module 5 (Frontend): Final Analysis & Summary
```

**Skip Logic**: Module 1 can bypass Modules 2-4 for obvious threats (dangerous + confidence >= 85%) by setting `skip_to_final=true` and `skip_reason`.

### Configuration System

**CRITICAL RULE**: Never hardcode IPs, ports, or URLs. ALWAYS use `config_loader.get_config()`.

**Config Priority**: 
1. Environment variables (`.env`)
2. `config.ini` 
3. Hardcoded defaults (last resort)

```python
from config_loader import get_config
config = get_config()
url = config.get_module1_url()  # Returns http://127.0.0.1:8001
host = config.get_module1_host()  # Returns 127.0.0.1
port = config.get_module1_port()  # Returns 8001
```

**Frontend Configuration**: Uses `config-loader.js` to read `config.ini` at build time, generates Next.js rewrites dynamically.

## Development Workflow

### Starting the System

```powershell
# Full system startup (6 separate windows)
start-all.bat

# Individual components
python orchestrator.py              # Start gateway first
cd module1\backend && python main.py
cd module2\backend && python main.py
cd module3\backend && python main.py
cd module4\backend && python main.py
cd frontend && npm run dev
```

**Startup Order**: Orchestrator → Backend Modules (parallel) → Frontend

### Environment Setup

Required files:
- `.env` (root): API keys (GEMINI_API_KEY, GOOGLE_API_KEY)
- `config.ini`: Host/port configuration
- `.env.local` (frontend): NEXT_PUBLIC_API_URL for production

All modules load `.env` from project root using `utils/env_loader.py`.

## Code Patterns & Conventions

### API Request Pattern

```typescript
// CORRECT: Relative path through orchestrator proxy
const response = await fetch('/module1/api/health')
const data = await fetch('/module2/api/output')

// WRONG: Direct backend calls
const response = await fetch('http://localhost:8001/api/health') // ❌ NEVER
```

Next.js rewrites handle the routing:
```javascript
// next.config.js
async rewrites() {
  return [
    { source: '/module1/:path*', destination: `${orchestratorUrl}/module1/:path*` }
  ]
}
```

### Backend Module Structure

Every module MUST implement these endpoints:
- `GET /api/health`: Service health check
- `GET /api/input`: Current input data (from previous module)
- `GET /api/output`: Processed output data
- `GET /api/status`: Processing state (idle/processing/completed)
- `POST /api/run_*`: Trigger processing (async, returns immediately)

**Standard Response Format**:
```json
{
  "status": "success",
  "data": {...}
}
```

**Error Response Format**:
```json
{
  "error": "Human-readable message",
  "details": "Technical details"
}
```

### Module Initialization Pattern

```python
from pathlib import Path
import sys

# 1. Load environment variables from root .env
root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(root))
from utils.env_loader import load_env_file
env_path = root / '.env'
load_env_file(env_path)

# 2. Load configuration
from config_loader import get_config
config = get_config()

# 3. Setup FastAPI with config-driven CORS
app = FastAPI(title="Module1 Service")

allowed_origins = [
    config.get_frontend_url(),
    f"http://localhost:{config.get_frontend_port()}",
    f"http://127.0.0.1:{config.get_frontend_port()}"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# 4. Start server with config-driven host/port
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=config.get_module1_host(),
        port=config.get_module1_port()
    )
```

### Inter-Module Communication

**Backend-to-Backend** (async, fire-and-forget):
```python
async def trigger_module2():
    module2_url = config.get_module2_url()
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{module2_url}/api/process",
                timeout=60.0
            )
            if response.status_code == 200:
                logger.info("Module 2 triggered")
        except httpx.ConnectError:
            logger.error("Module 2 not reachable")
```

**Data Exchange**: Modules communicate via JSON files:
- Module 1 writes: `module1/backend/input.json`, `output.json`
- Module 2 reads Module 1's output, writes: `module2/backend/output.json`, `module3/backend/input.json`
- Module 3 writes: `module3/backend/final_output/{leftist,rightist,common}.json`
- Module 4 writes: `module4/backend/debate_result.json`

### Session Management (Frontend)

Uses `lib/session-manager.ts` with localStorage for cross-module state persistence:

```typescript
import { saveModule1Data, getModule1Data, updateSession } from '@/lib/session-manager'

// Save module data
saveModule1Data({ input, analysisMode: 'text', result })

// Retrieve across modules
const module1Data = getModule1Data()
const hasData = hasModuleData(1)

// Clear for new session
await clearAllData()  // Clears localStorage + backend files
```

**Session Expiry**: 24 hours

### Significance Score Logic (Module 2)

**CRITICAL**: Inverse relationship between Module 1 confidence and Module 2 significance.

```python
# Low confidence (ambiguous) = High significance (needs debate)
if confidence >= 0.95 and risk_level == "dangerous":
    significance = 10-20  # Obvious threat, skip to final
elif confidence >= 0.80:
    significance = 30-50  # Moderate debate
elif confidence >= 0.60:
    significance = 60-75  # High debate significance
elif confidence >= 0.40:
    significance = 80-90  # Critical debate needed
else:
    significance = 5-15   # Low threat
```

This ensures ambiguous content gets thorough debate analysis.

## Project-Specific Rules (CRITICAL)

### Rule 0: No Patch Work
**Never** add quick fixes or logs to patch issues. ALWAYS analyze the full algorithm and rebuild properly. Migrate logic completely, don't layer hacks.

### Rule 5: Performance Optimization
Every code change must be optimized. Avoid unnecessary loops, API calls, or processing. Example: Module 3 caches perspectives by input hash to avoid regeneration.

### Rule 6: Production Code Standards
- NO emojis in code, logs, or API responses
- NO double hyphens in production content
- NO unnecessary logs that slow performance (debug only)

### Rule 8: Backward Compatibility
For every change, verify older logic doesn't break. Migrate dependencies properly. Example: When adding `skip_to_final` to Module 1, ensure Module 2/3 handle both skip and non-skip paths.

### Rule 10-30: API Standards (see `.github/instructions/api-rules.instructions.md`)
- All URLs from `config_loader.get_config()`
- Orchestrator proxy pattern: `/{module_name}/{path}`
- Standard endpoints: `/api/health`, `/api/input`, `/api/output`, `/api/status`
- Timeouts: 2s for health checks, 30s+ for processing
- Error responses include `"error"` key with message

## Adding a New Module

Checklist:
1. Create `module{N}/backend/main.py` with FastAPI
2. Implement required endpoints (`/api/health`, `/api/input`, `/api/output`, `/api/status`)
3. Load config: `config = get_config()`
4. Configure CORS from config
5. Use config for host/port in `uvicorn.run()`
6. Add module to `orchestrator.py` MODULES dict
7. Add methods to `config_loader.py` (`get_module{N}_url/host/port`)
8. Add section to `config.ini`: `[module{N}]`
9. Update `frontend/next.config.js` rewrites
10. Create `start-module{N}.bat`
11. Update `start-all.bat`
12. Test via orchestrator: `http://localhost:8000/module{N}/api/health`

## Debugging Tips

### Check Service Health
```bash
curl http://localhost:8000/module1/api/health
curl http://localhost:8000/module2/api/health
```

### View Module Data
```bash
# Check what data modules have
curl http://localhost:8000/module1/api/output
curl http://localhost:8000/module2/api/input
curl http://localhost:8000/module3/api/status
```

### Common Issues

**"Service unavailable"**: Module not running. Start with `start-module{N}.bat`.

**CORS errors**: Check `allowed_origins` includes frontend URL from config.

**"Config file not found"**: Verify `config.ini` exists in project root.

**"No input data"**: Previous module hasn't completed. Check `module{N-1}/backend/output.json`.

## AI/LLM Integration

### Gemini API Usage
Models: `gemini-2.0-flash` (Module 1, 4), `gemini-2.5-flash` (Module 2, 3)

```python
import google.generativeai as genai
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-2.0-flash")
response = model.generate_content(prompt)
```

**API Key**: Set in root `.env` as `GEMINI_API_KEY` or `GOOGLE_API_KEY`.

### Module 4 Debate System
Uses Gemini to simulate two AI agents (Leftist/Rightist) debating information trustworthiness. Judge AI assigns final trust score (0-100%).

**Dynamic Rounds**: 1-3 rounds based on debate depth.

**Enrichment** (optional): Uses Google Custom Search + Selenium to scrape web evidence before debate. Requires `search_engine_id` in `module4/backend/config.json`.

## Deployment

### Local Development
```powershell
start-all.bat  # Windows
# or individually start orchestrator + modules + frontend
```

### Google Cloud Run
```bash
# Frontend
cd frontend
gcloud run deploy idkai-frontend --source . --region us-central1

# Backend (orchestrator + modules)
./deploy-backend.ps1
```

Backend services ship with dedicated Dockerfiles:
- `orchestrator/Dockerfile`
- `module1/backend/Dockerfile`
- `Module2/backend/Dockerfile`
- `module3/backend/Dockerfile`
- `module4/backend/Dockerfile`

The deployment script builds each service from the repository root using these Dockerfiles.

**Environment Variables**: Set via `--set-env-vars GEMINI_API_KEY=...`

See `GCP_DEPLOY.md` and `QUICK_START_GCP.md` for full deployment guide.

## Testing

### Manual Pipeline Test
1. Access frontend: `http://localhost:3001` (port from config)
2. Module 1: Enter text/URL/image
3. Check skip logic: High confidence should skip to Module 5
4. Module 2: View classification + significance score
5. Module 3: See generated perspectives
6. Module 4: Run AI debate, view trust score
7. Module 5: Review final analysis
8. Click "New Session" to clear all data

### API Test
```powershell
# Test orchestrator routing
curl http://localhost:8000/module1/api/health

# Test Module 1 analysis
curl -X POST http://localhost:8000/module1/api/analyze `
  -H "Content-Type: application/json" `
  -d '{"input":"Click here to win $1000!"}'

# Check Module 2 output
curl http://localhost:8000/module2/api/output
```

## Key Files Reference

- `orchestrator.py`: API gateway with module registry
- `config_loader.py`: Centralized config management
- `config.ini`: Service host/port configuration
- `.env`: API keys and secrets
- `frontend/next.config.js`: Dynamic proxy rewrites
- `frontend/lib/session-manager.ts`: Cross-module state
- `.github/instructions/*.instructions.md`: Code rules for AI agents
- `API_PATTERNS.md`: Comprehensive API standards
- `start-all.bat`: Full system startup script

## References

- API Patterns: `API_PATTERNS.md`
- Deployment: `GCP_DEPLOY.md`, `QUICK_START_GCP.md`
- Module READMEs: `module{1-4}/backend/README.md`
- Code Rules: `.github/instructions/rules.instructions.md`
- API Rules: `.github/instructions/api-rules.instructions.md`
