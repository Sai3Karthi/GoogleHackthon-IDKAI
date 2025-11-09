# IDK-AI Assistant Primer

## Architecture & Flow
- Requests flow through the orchestrator proxy in orchestrator/app.py, which maps /module{N}/** to FastAPI services using config.ini; never target module ports directly.
- Pipeline order stays Module 1 → Module 2 → Module 3 → Module 4 with the frontend summarizing results, and Module 1 may short-circuit later stages when skip_to_final is true.
- Module 1 kicks off downstream processing via asyncio.create_task(trigger_pipeline_background), so new async work should plug into that pattern instead of blocking responses.
- Shared logic lives in utils/ and database/, so prefer extending those helpers over reimplementing request, logging, or persistence code.

## Configuration
- Always call config_loader.get_config() for URLs, hosts, and ports; environment variables override config.ini, and deployed URLs automatically route through the orchestrator path.
- Services load secrets from the root .env via utils/env_loader.py before touching config or credentials; replicate that boot order in new entrypoints.
- The frontend build script frontend/config-loader.js reads config.ini to generate Next.js rewrites, keeping browser fetches on relative paths like /module2/api/output.

## Persistence & Sessions
- Module 1 persists input metadata and output payloads through database/pipeline_store.py, returning a session_id that downstream modules must echo back to clients.
- Module 2–4 fetch prior results with get_pipeline_session and get_module_result, then write their own outputs using save_module_result plus update_session_status.
- database/session.py bootstraps both async and sync SQLAlchemy engines off DATABASE_URL (or config.ini [database]); respect its pooling choices when adding new tasks.

## Module Behaviors
- module1/backend/main.py detects input types, runs quick URL checks, optional scraping, and Gemini analysis, then stores results and optionally flags skip_to_final.
- Module2/backend/main.py recalculates significance scores with an inverse-confidence curve, classifies content via Gemini, and refuses to run when the session status is unexpected.
- module3/backend/main.py batches perspective generation through main_modules/api_request, balances bias categories, and enforces MODULE3_MAX_CONCURRENCY when scheduling work.
- module4/backend/main.py conducts multi-round debates, can enrich evidence via relevance_search.py, and records trust scores plus transcripts back into the module results table.

## Frontend Pattern
- API routes in frontend/app/api/** call relative URLs so the orchestrator proxy handles networking; adding absolute hosts will break next.config.js rewrites.
- frontend/lib/session-manager.ts mirrors backend session IDs in localStorage; confirm new responses include the fields it reads (e.g., detailed_analysis, debate_summary).
- UI components in frontend/components/modules/ expect consistent shapes—for example, module 2 cards read detailed_analysis.classification.*, so keep response contracts stable.

## Dev Workflows
- On Windows, run python orchestrator.py, then python moduleN/backend/main.py for each service, or use start-all.bat to spawn orchestrator → modules → frontend (npm run dev).
- preflight-check.bat verifies Python, open ports, .env contents, Google auth, and node_modules; fix its warnings before demos to prevent runtime failures.
- Sparse tests (e.g., module4/backend/test_api_flow.py) use asyncio; mirror their pattern when adding regression coverage.

## Gotchas
- Sessions flagged skip_to_final or skipped must be ignored gracefully by downstream modules and frontend views—never assume debate artifacts exist.
- Health checks time out at 2s and processing endpoints expect ≥30s budgets per .github/instructions/api-rules.instructions.md; align new clients and servers with that.
- PipelineRegistry in module3/backend/main.py prevents duplicate runs; catching PipelineAlreadyRunningError is the supported way to signal busy state.
- Repo rules forbid hardcoded URLs, emojis, double hyphens, or noisy logs in production paths; prioritize performance and full algorithmic fixes over quick patches.

