"""Module 3 service for perspective generation and persistence."""

from __future__ import annotations

import os
import sys

if sys.platform.startswith("win"):
    os.environ.setdefault("PYTHONASYNCIO_USE_SELECTOR", "1")

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

try:
    from utils.logger import setup_logger

    logger = setup_logger(__name__)
except ImportError:  # pragma: no cover - fallback for minimal environments
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)


ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR))

try:
    from utils.env_loader import load_env_file

    env_path = ROOT_DIR / ".env"
    if load_env_file(env_path):
        logger.info("Environment variables loaded from %s", env_path)
except (ImportError, ValueError):
    try:
        from dotenv import load_dotenv

        env_path = ROOT_DIR / ".env"
        load_dotenv(env_path)
        logger.info("Environment variables loaded via python-dotenv from %s", env_path)
    except ImportError:
        logger.info("Using system environment variables (python-dotenv not available)")


try:
    from config_loader import get_config

    config = get_config()
    logger.info("Configuration loaded successfully")
except Exception as config_error:  # pylint: disable=broad-except
    logger.warning("Could not load config: %s. Using environment defaults.", config_error)
    config = None

from database import (  # type: ignore  # added after adjusting sys.path
    initialize_database_schema,
    get_async_session,
    get_module_result,
    get_pipeline_session,
    save_module_result,
    update_session_status,
    ModuleResult,
    ModuleResultNotFoundError,
    SessionNotFoundError,
)

sys.path.append(str(Path(__file__).parent / "main_modules"))
from main_modules import api_request


MODULE3_RESULT_NAME = "module3"
MODULE4_INPUT_NAME = "module4_input"
MODULE3_INPUT_NAME = "module3_input"

if config:
    HOST = config.get_module3_host()
    PORT = config.get_module3_port()
    FRONTEND_PORT = config.get_frontend_port()
    FRONTEND_URL = config.get_frontend_url()
else:
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = int(os.getenv("MODULE3_PORT", 8003))
    FRONTEND_PORT = int(os.getenv("FRONTEND_PORT", 3000))
    FRONTEND_URL = os.getenv("FRONTEND_URL", f"http://localhost:{FRONTEND_PORT}")

port_override = os.getenv("PORT")
if port_override:
    PORT = int(port_override)
    HOST = "0.0.0.0"

allowed_origins = [
    origin
    for origin in [
        FRONTEND_URL,
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
    ]
    if origin
]
allowed_origins = list(dict.fromkeys(allowed_origins))

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

_concurrency_raw = os.getenv("MODULE3_MAX_CONCURRENCY", "4").strip()
if not _concurrency_raw:
    _concurrency_raw = "4"
try:
    MAX_CONCURRENT_PIPELINES = int(_concurrency_raw)
    if MAX_CONCURRENT_PIPELINES <= 0:
        MAX_CONCURRENT_PIPELINES = None
except ValueError:
    MAX_CONCURRENT_PIPELINES = 4


class RunPipelineRequest(BaseModel):
    session_id: str = Field(..., description="Pipeline session identifier from Module 1")
    send_to_module4: bool = Field(
        default=False,
        description="Forward generated perspectives to Module 4 after completion",
    )


class SendToModule4Request(BaseModel):
    session_id: str = Field(..., description="Pipeline session identifier")


class MarkFirstViewConsumedRequest(BaseModel):
    session_id: str = Field(..., description="Pipeline session identifier")


CATEGORY_KEYS: Tuple[str, str, str] = ("leftist", "rightist", "common")
LEFTIST_THRESHOLD = 0.428
RIGHTIST_THRESHOLD = 0.571


def clamp_bias(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.5


def safe_significance(value: Any) -> float:
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 0.0


def determine_target_size(total: int) -> int:
    """Mirror historical clustering thresholds to preserve debate payload size."""
    if total <= 0:
        return 0
    if 7 <= total <= 14:
        return 6
    if 15 <= total <= 28:
        return 14
    if 29 <= total <= 77:
        return 21
    if 78 <= total <= 136:
        return 28
    return total


def allocate_category_slots(counts: Dict[str, int], target: int) -> Dict[str, int]:
    """Determine how many items to keep for each bias category."""
    if target <= 0:
        return {key: 0 for key in CATEGORY_KEYS}

    total_available = sum(max(counts.get(key, 0), 0) for key in CATEGORY_KEYS)
    if total_available == 0 or target >= total_available:
        return {key: max(counts.get(key, 0), 0) for key in CATEGORY_KEYS}

    provisional: Dict[str, int] = {}
    for key in CATEGORY_KEYS:
        pool_size = max(counts.get(key, 0), 0)
        if pool_size == 0:
            provisional[key] = 0
            continue
        share = (pool_size / total_available) * target
        provisional[key] = min(pool_size, int(round(share)))

    allocated = sum(provisional.values())

    while allocated > target:
        candidate = max(
            CATEGORY_KEYS,
            key=lambda key: (provisional[key], counts.get(key, 0)),
        )
        if provisional[candidate] == 0:
            break
        provisional[candidate] -= 1
        allocated -= 1

    while allocated < target:
        candidate = max(
            CATEGORY_KEYS,
            key=lambda key: (counts.get(key, 0) - provisional[key], counts.get(key, 0)),
        )
        capacity = counts.get(candidate, 0) - provisional[candidate]
        if capacity <= 0:
            break
        provisional[candidate] += 1
        allocated += 1

    return provisional


def distribute_perspectives(
    perspectives: List[Dict[str, Any]]
) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Any]]:
    """Derive a trimmed, bias-balanced perspective set with summary metadata."""
    pools: Dict[str, List[Dict[str, Any]]] = {key: [] for key in CATEGORY_KEYS}

    for item in perspectives:
        if not isinstance(item, dict):
            continue

        normalized = dict(item)
        normalized["bias_x"] = clamp_bias(normalized.get("bias_x"))
        normalized["significance_y"] = safe_significance(normalized.get("significance_y"))

        bias_value = normalized["bias_x"]
        if bias_value < LEFTIST_THRESHOLD:
            pools["leftist"].append(normalized)
        elif bias_value > RIGHTIST_THRESHOLD:
            pools["rightist"].append(normalized)
        else:
            pools["common"].append(normalized)

    total_generated = sum(len(pool) for pool in pools.values())
    target_size = determine_target_size(total_generated)

    if target_size >= total_generated:
        summary = {
            "total_generated": total_generated,
            "target_size": target_size,
            "category_counts": {key: len(pool) for key, pool in pools.items()},
            "distribution_source": "direct",
        }
        return pools, summary

    allocations = allocate_category_slots(
        {key: len(pool) for key, pool in pools.items()},
        target_size,
    )

    selected: Dict[str, List[Dict[str, Any]]] = {}
    for key in CATEGORY_KEYS:
        pool = pools.get(key, [])
        allocation = max(allocations.get(key, 0), 0)
        if allocation == 0 or not pool:
            selected[key] = []
            continue
        sorted_pool = sorted(
            pool,
            key=lambda item: safe_significance(item.get("significance_y")),
            reverse=True,
        )
        selected[key] = sorted_pool[:allocation]

    selected_total = sum(len(items) for items in selected.values())
    summary = {
        "total_generated": total_generated,
        "target_size": target_size,
        "category_counts": {key: len(selected.get(key, [])) for key in CATEGORY_KEYS},
        "pool_counts": {key: len(pools.get(key, [])) for key in CATEGORY_KEYS},
        "allocations": allocations,
        "selected_total": selected_total,
        "shortfall": max(0, target_size - selected_total),
        "distribution_source": "stratified_selection",
    }
    return selected, summary


class PipelineRegistryError(RuntimeError):
    """Base exception for pipeline registry operations."""


class PipelineAlreadyRunningError(PipelineRegistryError):
    """Raised when attempting to start a pipeline that is already running."""


class PipelineCapacityExceededError(PipelineRegistryError):
    """Raised when the registry has reached its concurrency capacity."""


@dataclass
class PipelineJob:
    session_id: str
    send_to_module4: bool
    started_at: datetime
    task: asyncio.Task

    def as_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "send_to_module4": self.send_to_module4,
            "started_at": self.started_at.isoformat(),
            "done": self.task.done(),
        }


class PipelineRegistry:
    def __init__(self, max_concurrent: Optional[int] = None) -> None:
        self._max_concurrent = max_concurrent if (max_concurrent or 0) > 0 else None
        self._lock = asyncio.Lock()
        self._jobs: Dict[str, PipelineJob] = {}

    async def start(self, session_id: str, send_to_module4: bool, runner) -> None:
        async with self._lock:
            if session_id in self._jobs and not self._jobs[session_id].task.done():
                raise PipelineAlreadyRunningError(f"Session {session_id} already running")

            active_jobs = [job for job in self._jobs.values() if not job.task.done()]
            if self._max_concurrent is not None and len(active_jobs) >= self._max_concurrent:
                raise PipelineCapacityExceededError(
                    f"Maximum concurrent pipelines ({self._max_concurrent}) reached"
                )

            task = asyncio.create_task(runner(session_id, send_to_module4))
            job = PipelineJob(
                session_id=session_id,
                send_to_module4=send_to_module4,
                started_at=datetime.now(timezone.utc),
                task=task,
            )
            self._jobs[session_id] = job
            task.add_done_callback(lambda finished: asyncio.create_task(self._finalize(session_id, finished)))

    async def _finalize(self, session_id: str, task: asyncio.Task) -> None:
        try:
            exc = task.exception()
            if exc is not None:
                logger.error(
                    "Pipeline task failed for session %s: %s",
                    session_id,
                    exc,
                    exc_info=(type(exc), exc, exc.__traceback__),
                )
        except asyncio.CancelledError:
            logger.warning("Pipeline task cancelled for session %s", session_id)
        finally:
            async with self._lock:
                job = self._jobs.get(session_id)
                if job and job.task is task:
                    self._jobs.pop(session_id, None)

    async def snapshot(self) -> List[Dict[str, Any]]:
        async with self._lock:
            return [job.as_dict() for job in self._jobs.values() if not job.task.done()]

    async def is_running(self, session_id: str) -> bool:
        async with self._lock:
            job = self._jobs.get(session_id)
            return bool(job and not job.task.done())

    async def active_count(self) -> int:
        async with self._lock:
            return sum(1 for job in self._jobs.values() if not job.task.done())


pipeline_registry = PipelineRegistry(MAX_CONCURRENT_PIPELINES)
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Module3 server starting up...")
    try:
        initialize_database_schema()
        logger.info("Database schema ensured")
    except Exception as db_error:  # pylint: disable=broad-except
        logger.error("Failed to initialize database schema: %s", db_error)
        raise
    yield
    logger.info("Module3 server shutting down...")


app = FastAPI(
    title="Module3 Perspective Generation API",
    description="Generates political perspectives using Vertex AI and persists the output",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


async def fetch_session_or_404(session_id: Optional[str]) -> str:
    if not session_id or not str(session_id).strip():
        raise HTTPException(status_code=400, detail="session_id query parameter is required.")

    try:
        session = await get_pipeline_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found") from exc

    return str(session.id)


async def fetch_session_for_processing(session_id: str) -> None:
    try:
        session_record = await get_pipeline_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found") from exc

    if session_record.status not in {"module2_completed", "module3_processing", "module3_completed"}:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Session {session_id} is in status '{session_record.status}' and cannot be processed by Module 3."
            ),
        )


async def load_module3_input(session_id: str) -> Dict[str, Any]:
    try:
        module_result = await get_module_result(session_id, MODULE3_INPUT_NAME)
    except ModuleResultNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="Module 3 input not found for the requested session.",
        ) from exc

    payload = module_result.payload or {}
    if not payload:
        raise HTTPException(
            status_code=400,
            detail="Module 3 input payload is empty. Run Module 2 before Module 3.",
        )
    return payload


def build_storage_payload(
    session_id: str,
    module3_input: Dict[str, Any],
    perspectives: Any,
    *,
    final_output: Optional[Dict[str, Any]] = None,
    stage: str = "pending",
    frontend_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "session_id": session_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stage": stage,
        "input": module3_input,
        "perspectives": perspectives,
        "final_output": final_output,
    }
    if frontend_state is not None:
        payload["frontend_state"] = frontend_state
    return payload


async def persist_results(
    session_id: str,
    storage_payload: Dict[str, Any],
    *,
    status: str,
    include_module4: bool,
) -> None:
    existing_payload: Dict[str, Any] = {}
    try:
        existing_result = await get_module_result(session_id, MODULE3_RESULT_NAME)
        existing_payload = existing_result.payload or {}
    except ModuleResultNotFoundError:
        existing_payload = {}

    if existing_payload:
        existing_state = existing_payload.get("frontend_state") or {}
        new_state = storage_payload.get("frontend_state") or {}
        if existing_state or new_state:
            merged_state = {**existing_state, **new_state}
            storage_payload["frontend_state"] = merged_state

    await save_module_result(
        session_id=session_id,
        module_name=MODULE3_RESULT_NAME,
        payload=storage_payload,
        status=status,
    )

    if not include_module4:
        return

    final_output = storage_payload.get("final_output")
    if isinstance(final_output, dict) and final_output:
        await save_module_result(
            session_id=session_id,
            module_name=MODULE4_INPUT_NAME,
            payload=final_output,
            status="ready",
        )


async def send_to_module4(session_id: str, final_output: Dict[str, Any]) -> None:
    if config:
        module4_url = config.get_module4_url()
    else:
        module4_url = "http://127.0.0.1:8004"

    payload = {
        "session_id": session_id,
        "leftist": final_output.get("leftist"),
        "rightist": final_output.get("rightist"),
        "common": final_output.get("common"),
        "summary": final_output.get("summary"),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                f"{module4_url.rstrip('/')}/upload-perspectives",
                json=payload,
            )
            if response.status_code == 200:
                logger.info("Module 4 acknowledged perspectives for session %s", session_id)
            else:
                logger.warning(
                    "Module 4 returned status %s for session %s: %s",
                    response.status_code,
                    session_id,
                    response.text,
                )
        except httpx.HTTPError as exc:  # pragma: no cover - network dependent
            logger.warning("Failed to reach Module 4 for session %s: %s", session_id, exc)


async def execute_pipeline(
    session_id: str,
    send_to_m4: bool,
    module3_input: Optional[Dict[str, Any]] = None,
) -> None:
    await fetch_session_for_processing(session_id)
    if module3_input is None:
        module3_input = await load_module3_input(session_id)

    await update_session_status(session_id, "module3_processing")

    loop = asyncio.get_running_loop()
    last_stream_count = 0

    async def _persist_streaming_snapshot(
        snapshot: List[Dict[str, Any]],
        stage: str = "streaming",
    ) -> None:
        nonlocal last_stream_count
        storage_payload = build_storage_payload(
            session_id,
            module3_input,
            snapshot,
            final_output=None,
            stage=stage,
            frontend_state={"first_view_consumed": False},
        )
        await persist_results(
            session_id,
            storage_payload,
            status="processing",
            include_module4=False,
        )
        last_stream_count = len(snapshot)

    def _progress_handler(
        color_name: str,
        batch: List[Dict[str, Any]],
        all_perspectives: List[Dict[str, Any]],
    ) -> None:
        if not all_perspectives:
            return

        if len(all_perspectives) == last_stream_count:
            return

        snapshot = [dict(item) for item in all_perspectives]
        future = asyncio.run_coroutine_threadsafe(
            _persist_streaming_snapshot(snapshot, "streaming"),
            loop,
        )
        try:
            future.result()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Streaming persistence failed for session %s during %s batch: %s",
                session_id,
                color_name,
                exc,
            )

    try:
        generation_result = await asyncio.to_thread(
            api_request.generate_perspectives,
            module3_input,
            progress_callback=_progress_handler,
        )
        base_perspectives = []
        if isinstance(generation_result, dict):
            base_perspectives = generation_result.get("perspectives", [])

        if not base_perspectives:
            raise RuntimeError("Perspective generation produced no results.")

        partial_payload = build_storage_payload(
            session_id,
            module3_input,
            base_perspectives,
            final_output=None,
            stage="perspectives_ready",
            frontend_state={"first_view_consumed": False},
        )
        await persist_results(
            session_id,
            partial_payload,
            status="processing",
            include_module4=False,
        )
        logger.info("Base perspectives stored for session %s", session_id)

        distribution, summary = await asyncio.to_thread(
            distribute_perspectives,
            base_perspectives,
        )
        final_output_payload: Dict[str, Any] = {**distribution, "summary": summary}
        logger.info("Perspective distribution for session %s: %s", session_id, summary)
        if summary.get("shortfall", 0):
            logger.warning(
                "Perspective distribution shortfall detected for session %s: %s",
                session_id,
                summary["shortfall"],
            )
        final_perspectives = base_perspectives
        final_payload = build_storage_payload(
            session_id,
            module3_input,
            final_perspectives,
            final_output=final_output_payload,
            stage="completed",
            frontend_state={"first_view_consumed": False},
        )
        await persist_results(
            session_id,
            final_payload,
            status="completed",
            include_module4=True,
        )
        await update_session_status(session_id, "module3_completed")

        final_output = final_payload.get("final_output")
        if send_to_m4 and isinstance(final_output, dict):
            await send_to_module4(session_id, final_output)

        logger.info("Module 3 completed for session %s", session_id)

    except Exception as exc:  # pylint: disable=broad-except
        await update_session_status(session_id, "module2_completed")
        logger.exception("Module 3 pipeline failed for session %s", session_id)
        storage_payload = {
            "session_id": session_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }
        await save_module_result(
            session_id=session_id,
            module_name=MODULE3_RESULT_NAME,
            payload=storage_payload,
            status="failed",
        )


async def get_module3_payload(session_id: str) -> Dict[str, Any]:
    try:
        result = await get_module_result(session_id, MODULE3_RESULT_NAME)
    except ModuleResultNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Module 3 output not available.") from exc
    return result.payload or {}


async def purge_module_results(
    module_names: List[str],
    session_uuid: Optional[uuid.UUID] = None,
) -> int:
    if not module_names:
        return 0

    normalized = [name.lower() for name in module_names if isinstance(name, str)]
    if not normalized:
        return 0

    async with get_async_session() as session:
        stmt = delete(ModuleResult).where(ModuleResult.module_name.in_(normalized))
        if session_uuid is not None:
            stmt = stmt.where(ModuleResult.session_id == session_uuid)

        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount or 0


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "message": "Module 3 perspective generator",
        "version": "2.0.0",
        "endpoints": {
            "POST /api/run_pipeline_stream": "Run perspective pipeline for a session",
            "GET /api/input": "Retrieve Module 3 input payload",
            "GET /api/output": "Retrieve Module 3 output payload",
            "GET /module3/output/{category}": "Retrieve a specific perspective set",
            "POST /api/send_to_module4": "Forward stored results to Module 4",
            "GET /api/status": "Pipeline + persistence status",
            "GET /api/health": "Health check",
        },
    }


@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
    db_status = "reachable"
    try:
        async with get_async_session() as session:
            await session.execute(select(1))
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Database health check failed: %s", exc)
        db_status = f"error: {exc}"

    active_pipelines = await pipeline_registry.active_count()

    return {
        "status": "healthy" if db_status == "reachable" else "degraded",
        "server_time": time.time(),
        "active_pipelines": active_pipelines,
        "max_concurrency": MAX_CONCURRENT_PIPELINES,
        "database": db_status,
    }


@app.get("/api/status")
async def get_status(
    session_id: str = Query(..., description="Pipeline session identifier")
) -> Dict[str, Any]:
    resolved_session = await fetch_session_or_404(session_id)

    module3_available = False
    module3_stage: Optional[str] = None
    final_output_ready = False
    first_view_consumed = False
    try:
        result = await get_module_result(resolved_session, MODULE3_RESULT_NAME)
        module3_available = True
        payload = result.payload or {}
        module3_stage = payload.get("stage") if isinstance(payload, dict) else None
        final_data = payload.get("final_output") if isinstance(payload, dict) else None
        final_output_ready = isinstance(final_data, dict) and bool(final_data)
        if isinstance(payload, dict):
            frontend_state = payload.get("frontend_state") or {}
            if isinstance(frontend_state, dict):
                first_view_consumed = bool(frontend_state.get("first_view_consumed"))
    except ModuleResultNotFoundError:
        module3_available = False

    active_jobs = await pipeline_registry.snapshot()
    session_running = bool(
        any(job["session_id"] == resolved_session for job in active_jobs)
    )

    return {
        "resolved_session": resolved_session,
        "module3_output_available": module3_available,
        "module3_stage": module3_stage,
        "final_output_ready": final_output_ready,
    "first_view_consumed": first_view_consumed,
        "session_running": session_running,
        "active_pipelines": active_jobs,
        "active_count": len(active_jobs),
        "max_concurrency": MAX_CONCURRENT_PIPELINES,
    }


@app.get("/api/input")
async def get_input(
    session_id: str = Query(..., description="Pipeline session identifier")
) -> JSONResponse:
    resolved_session = await fetch_session_or_404(session_id)
    payload = await load_module3_input(resolved_session)
    return JSONResponse(payload)


@app.get("/api/output")
async def get_output(
    session_id: str = Query(..., description="Pipeline session identifier")
) -> JSONResponse:
    resolved_session = await fetch_session_or_404(session_id)
    payload = await get_module3_payload(resolved_session)
    return JSONResponse(payload)


@app.get("/module3/output/{category}")
async def get_categorized_output(
    category: str,
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> JSONResponse:
    resolved_session = await fetch_session_or_404(session_id)
    payload = await get_module3_payload(resolved_session)
    final_output = payload.get("final_output")

    if category not in {"leftist", "rightist", "common"}:
        raise HTTPException(status_code=400, detail="Category must be leftist, rightist, or common")

    if not isinstance(final_output, dict) or category not in final_output:
        return JSONResponse(
            {
                "status": "pending",
                "message": "Perspectives are still being generated",
                "category": category,
                "session_id": resolved_session,
            },
            status_code=status.HTTP_202_ACCEPTED,
        )

    return JSONResponse(final_output[category])


@app.post("/api/run_pipeline_stream")
async def run_pipeline_stream(request: RunPipelineRequest) -> JSONResponse:
    resolved_session = await fetch_session_or_404(request.session_id.strip())
    await fetch_session_for_processing(resolved_session)
    if await pipeline_registry.is_running(resolved_session):
        return JSONResponse(
            {
                "status": "busy",
                "message": "Pipeline already running for this session",
                "session_id": resolved_session,
            },
            status_code=409,
        )
    module3_input = await load_module3_input(resolved_session)

    async def runner(sid: str, send_flag: bool) -> None:
        payload = module3_input if sid == resolved_session else None
        await execute_pipeline(sid, send_flag, payload)

    try:
        await pipeline_registry.start(resolved_session, request.send_to_module4, runner)
    except PipelineAlreadyRunningError:
        return JSONResponse(
            {
                "status": "busy",
                "message": "Pipeline already running for this session",
                "session_id": resolved_session,
            },
            status_code=409,
        )
    except PipelineCapacityExceededError as exc:
        return JSONResponse(
            {
                "status": "capacity_exceeded",
                "message": str(exc),
                "session_id": resolved_session,
                "max_concurrency": MAX_CONCURRENT_PIPELINES,
            },
            status_code=429,
        )

    return JSONResponse(
        {
            "status": "started",
            "session_id": resolved_session,
            "forwarded_to_module4": request.send_to_module4,
        }
    )


@app.post("/api/send_to_module4")
async def send_stored_data_to_module4(request: SendToModule4Request) -> JSONResponse:
    resolved_session = await fetch_session_or_404(request.session_id)
    payload = await get_module3_payload(resolved_session)
    final_output = payload.get("final_output", {})

    if not final_output:
        raise HTTPException(status_code=404, detail="No final output stored for the requested session.")

    await send_to_module4(resolved_session, final_output)
    return JSONResponse({"status": "sent", "session_id": resolved_session})


@app.post("/api/mark_first_view_consumed")
async def mark_first_view_consumed(request: MarkFirstViewConsumedRequest) -> JSONResponse:
    resolved_session = await fetch_session_or_404(request.session_id.strip())

    try:
        result = await get_module_result(resolved_session, MODULE3_RESULT_NAME)
    except ModuleResultNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Module 3 output not available.") from exc

    payload = dict(result.payload or {})
    frontend_state = dict(payload.get("frontend_state") or {})

    if frontend_state.get("first_view_consumed") is True:
        return JSONResponse({
            "status": "unchanged",
            "session_id": resolved_session,
        })

    frontend_state["first_view_consumed"] = True
    payload["frontend_state"] = frontend_state

    await save_module_result(
        session_id=resolved_session,
        module_name=MODULE3_RESULT_NAME,
        payload=payload,
        status=result.status or "completed",
    )

    return JSONResponse({
        "status": "updated",
        "session_id": resolved_session,
    })


@app.post("/api/clear")
async def clear_local_cache(
    session_id: str = Query(..., description="Pipeline session identifier"),
    purge_all: bool = Query(
        False,
        description="When true, removes cached artifacts for all sessions (admin use only)",
    ),
) -> Dict[str, Any]:
    module_keys = [MODULE3_RESULT_NAME, MODULE4_INPUT_NAME]

    if purge_all:
        deleted = await purge_module_results(module_keys)
        return {
            "status": "cleared",
            "scope": "all",
            "records_removed": deleted,
            "modules": module_keys,
        }

    resolved_session = await fetch_session_or_404(session_id)
    session_record = await get_pipeline_session(resolved_session)
    deleted = await purge_module_results(module_keys, session_record.id)
    return {
        "status": "cleared",
        "scope": "session",
        "session_id": resolved_session,
        "records_removed": deleted,
        "modules": module_keys,
    }


# ---------------------------------------------------------------------------
# Server entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting Module 3 server on %s:%s", HOST, PORT)

    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def _serve() -> None:
        config_obj = uvicorn.Config(app, host=HOST, port=PORT, log_level="info")
        server = uvicorn.Server(config_obj)
        await server.serve()

    asyncio.run(_serve())
