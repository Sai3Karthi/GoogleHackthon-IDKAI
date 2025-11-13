"""Module 4 backend service with database-driven enrichment and debate."""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:  # pragma: no cover - defensive guard
        pass

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

try:
    from utils.logger import setup_logger  # type: ignore

    logger = setup_logger(__name__)
except ImportError:  # pragma: no cover - fallback for minimal environments
    import logging

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)


ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

try:
    from utils.env_loader import load_env_file  # type: ignore

    load_env_file(ROOT_DIR / ".env")
except Exception as env_error:  # pylint: disable=broad-except
    logger.debug("Environment load skipped: %s", env_error)

try:
    from config_loader import get_config  # type: ignore

    config = get_config()
except Exception as config_error:  # pylint: disable=broad-except
    logger.warning("Config load failed: %s", config_error)
    config = None

from database import (  # type: ignore  # adjusted sys.path
    ModuleResult,
    ModuleResultNotFoundError,
    PipelineSession,
    SessionNotFoundError,
    get_async_session,
    get_module_result,
    get_pipeline_session,
    initialize_database_schema,
    save_module_result,
    update_session_status,
)

from debate import DebateOrchestrator
from relevance_search import RelevanceSearchSystem


MODULE3_RESULT_NAME = "module3"
MODULE4_INPUT_NAME = "module4_input"
MODULE4_ENRICHMENT_NAME = "module4_enrichment"
MODULE4_DEBATE_NAME = "module4_debate"
CATEGORY_KEYS = ("leftist", "rightist", "common")


DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)


if config:
    HOST = config.get_module4_host()
    PORT = config.get_module4_port()
    FRONTEND_PORT = config.get_frontend_port()
    FRONTEND_URL = config.get_frontend_url()
else:
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = int(os.getenv("MODULE4_PORT", 8004))
    FRONTEND_PORT = int(os.getenv("FRONTEND_PORT", 3000))
    FRONTEND_URL = os.getenv("FRONTEND_URL", f"http://localhost:{FRONTEND_PORT}")

port_override = os.getenv("PORT")
if port_override:
    PORT = int(port_override)
    HOST = "0.0.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):  # pragma: no cover - startup hook
    logger.info("Module 4 service starting")
    try:
        initialize_database_schema()
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to initialize database schema: %s", exc)
        raise
    yield
    logger.info("Module 4 service shutting down")


app = FastAPI(
    title="Module 4 Debate & Analysis API",
    description="Runs enrichment and debate for pipeline sessions",
    version="2.0.0",
    lifespan=lifespan,
)


allowed_origins = [
    origin
    for origin in {
        FRONTEND_URL,
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
    }
    if origin
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception as loop_error:  # pragma: no cover - defensive guard
        logger.debug("Event loop policy setup skipped: %s", loop_error)


debate_cache: Dict[str, Dict[str, Any]] = {}
debate_cache_lock = asyncio.Lock()


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_uuid(value: str | uuid.UUID) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


async def resolve_session_id(session_id: Optional[str]) -> str:
    if not session_id or not str(session_id).strip():
        raise HTTPException(status_code=400, detail="session_id query parameter is required.")

    try:
        record = await get_pipeline_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found") from exc

    return str(record.id)


def normalize_input_payload(raw: Any) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Any]]:
    categories = {key: [] for key in CATEGORY_KEYS}
    metadata: Dict[str, Any] = {}

    if not isinstance(raw, dict):
        return categories, metadata

    if "categories" in raw and isinstance(raw["categories"], dict):
        cat_data = raw["categories"]
        for key in CATEGORY_KEYS:
            value = cat_data.get(key, [])
            categories[key] = value if isinstance(value, list) else []
        metadata = {k: v for k, v in raw.items() if k != "categories"}
        return categories, metadata

    found = False
    for key in CATEGORY_KEYS:
        value = raw.get(key)
        if isinstance(value, list):
            categories[key] = value
            found = True

    extras = {k: v for k, v in raw.items() if k not in CATEGORY_KEYS}
    if extras:
        metadata.update(extras)

    if not found:
        final_output = raw.get("final_output")
        if isinstance(final_output, dict):
            for key in CATEGORY_KEYS:
                value = final_output.get(key)
                if isinstance(value, list):
                    categories[key] = value
                    found = True
            metadata.setdefault("source", "module3_final_output")

    if not found:
        metadata.setdefault("note", "No perspective categories found")

    return categories, metadata


def derive_topic(metadata: Dict[str, Any], categories: Dict[str, List[Dict[str, Any]]]) -> str:
    for field in ("topic", "title", "headline", "subject"):
        candidate = metadata.get(field)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

    for items in categories.values():
        for item in items:
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()[:120]

    return "Information Trustworthiness"


def derive_context(metadata: Dict[str, Any]) -> Optional[str]:
    for field in ("context_text", "text", "content", "original_text"):
        candidate = metadata.get(field)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


async def load_module4_input_data(session_id: str) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Any]]:
    raw_payload: Dict[str, Any] = {}

    try:
        record = await get_module_result(session_id, MODULE4_INPUT_NAME)
        raw_payload = record.payload or {}
    except ModuleResultNotFoundError:
        raw_payload = {}

    metadata: Dict[str, Any] = {}

    if not raw_payload:
        try:
            module3_record = await get_module_result(session_id, MODULE3_RESULT_NAME)
            module3_payload = module3_record.payload or {}
            final_output = module3_payload.get("final_output")
            if isinstance(final_output, dict):
                raw_payload = final_output
                metadata = {"source": "module3_fallback"}
                module3_input = module3_payload.get("input")
                if isinstance(module3_input, dict):
                    metadata.update(module3_input)
        except ModuleResultNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Perspective data not available for this session.") from exc

    categories, meta = normalize_input_payload(raw_payload)
    metadata = {**meta, **metadata}
    metadata.setdefault("session_id", session_id)
    return categories, metadata


async def load_enrichment_data(session_id: str) -> Optional[Dict[str, Any]]:
    try:
        record = await get_module_result(session_id, MODULE4_ENRICHMENT_NAME)
        return record.payload or {}
    except ModuleResultNotFoundError:
        return None


async def load_debate_data(session_id: str) -> Optional[Dict[str, Any]]:
    try:
        record = await get_module_result(session_id, MODULE4_DEBATE_NAME)
        return record.payload or {}
    except ModuleResultNotFoundError:
        return None


def compute_enrichment_summary(results: Dict[str, Any]) -> Tuple[int, Dict[str, Dict[str, int]]]:
    total_links = 0
    summary: Dict[str, Dict[str, int]] = {}

    for key in CATEGORY_KEYS:
        entry = results.get(key)
        if isinstance(entry, dict):
            items = entry.get("items", [])
        elif isinstance(entry, list):
            items = entry
        else:
            items = []

        cleaned = [item for item in items if isinstance(item, dict)]
        link_count = sum(len(item.get("relevant_links", [])) for item in cleaned)
        items_with_links = sum(1 for item in cleaned if item.get("relevant_links"))

        total_links += link_count
        summary[key] = {
            "total_items": len(cleaned),
            "items_with_links": items_with_links,
        }

    return total_links, summary


def flatten_enrichment_items_from_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    results = payload.get("results")
    if not isinstance(results, dict):
        results = payload

    items: List[Dict[str, Any]] = []
    for key in CATEGORY_KEYS:
        entry = results.get(key)
        if isinstance(entry, dict):
            source_items = entry.get("items", [])
        elif isinstance(entry, list):
            source_items = entry
        else:
            source_items = []

        for perspective in source_items:
            if not isinstance(perspective, dict):
                continue
            relevant_links = perspective.get("relevant_links", [])
            if not isinstance(relevant_links, list):
                continue

            base_text = perspective.get("text", "")
            if isinstance(base_text, str) and len(base_text) > 200:
                truncated_text = base_text[:200] + "..."
            else:
                truncated_text = base_text

            for link in relevant_links:
                if not isinstance(link, dict):
                    continue
                url = link.get("link") or link.get("url")
                if not url:
                    continue

                title = link.get("title", "")
                if isinstance(title, str):
                    title = title.replace("\n", " ").strip()

                snippet = link.get("extracted_content") or link.get("extracted_text") or link.get("snippet") or ""
                if isinstance(snippet, str) and len(snippet) > 200:
                    snippet = snippet[:200] + "..."
                elif not isinstance(snippet, str):
                    snippet = ""

                items.append(
                    {
                        "category": key,
                        "perspective_text": truncated_text,
                        "url": url,
                        "title": title if isinstance(title, str) else "",
                        "trust_score": float(link.get("trust_score", 0.0) or 0.0),
                        "source_type": link.get("source_type", "Unknown"),
                        "extracted_text": snippet,
                    }
                )

    return items


def extract_enriched_perspectives(payload: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    results = payload.get("results")
    if not isinstance(results, dict):
        results = payload

    enriched: Dict[str, List[Dict[str, Any]]] = {key: [] for key in CATEGORY_KEYS}
    for key in CATEGORY_KEYS:
        entry = results.get(key)
        if isinstance(entry, dict):
            items = entry.get("items", [])
        elif isinstance(entry, list):
            items = entry
        else:
            items = []
        enriched[key] = [item for item in items if isinstance(item, dict)]
    return enriched


def build_debate_messages(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    transcript = payload.get("debate_transcript", [])
    messages: List[Dict[str, Any]] = []

    for entry in transcript:
        if not isinstance(entry, dict):
            continue
        agent = entry.get("agent", "Unknown")
        text = entry.get("message") or entry.get("argument") or ""
        round_num = entry.get("round", 0)

        agent_lower = agent.lower() if isinstance(agent, str) else ""
        agent_type = "system"
        if "left" in agent_lower:
            agent_type = "leftist"
        elif "right" in agent_lower:
            agent_type = "rightist"
        elif "judge" in agent_lower or "moderator" in agent_lower:
            agent_type = "judge"

        messages.append(
            {
                "agent": agent,
                "agent_type": agent_type,
                "message": text,
                "round": round_num,
            }
        )

    return messages


async def set_debate_cache(session_id: str, payload: Dict[str, Any]) -> None:
    async with debate_cache_lock:
        debate_cache[session_id] = payload


async def get_debate_cache(session_id: str) -> Optional[Dict[str, Any]]:
    async with debate_cache_lock:
        return debate_cache.get(session_id)


async def clear_debate_cache(session_id: str) -> None:
    async with debate_cache_lock:
        debate_cache.pop(session_id, None)


async def delete_module_records(session_id: str, module_names: List[str]) -> int:
    if not module_names:
        return 0

    normalized = [name.lower() for name in module_names]
    target_id = ensure_uuid(session_id)

    async with get_async_session() as session:
        stmt = delete(ModuleResult).where(
            ModuleResult.session_id == target_id,
            ModuleResult.module_name.in_(normalized),
        )
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount or 0


class UploadPerspectivesRequest(BaseModel):
    session_id: str = Field(..., description="Pipeline session identifier")
    leftist: List[Dict[str, Any]] = Field(default_factory=list)
    rightist: List[Dict[str, Any]] = Field(default_factory=list)
    common: List[Dict[str, Any]] = Field(default_factory=list)
    topic: Optional[str] = None
    context_text: Optional[str] = None
    source: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "service": "Module 4 Debate & Analysis",
        "version": "2.0.0",
        "endpoints": {
            "health": "/api/health",
            "input": "/api/input",
            "output": "/api/output",
            "status": "/api/status",
            "upload": "/upload-perspectives",
            "enrich": "/api/enrich-perspectives",
            "debate": "/api/debate",
        },
    }


@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
    db_status = "reachable"
    try:
        async with get_async_session() as session:
            await session.execute(select(1))
    except Exception as exc:  # pylint: disable=broad-except
        db_status = f"error: {exc}"

    debate_ready = True
    debate_error: Optional[str] = None
    try:
        DebateOrchestrator()
    except Exception as exc:  # pylint: disable=broad-except
        debate_ready = False
        debate_error = str(exc)

    enrichment_ready = bool(os.getenv("WEB_SEARCH_API_KEY"))

    return {
        "status": "healthy" if db_status == "reachable" else "degraded",
        "timestamp": iso_now(),
        "database": db_status,
        "debate_available": debate_ready,
        "debate_error": debate_error,
        "enrichment_available": enrichment_ready,
    }


@app.get("/api/input")
async def get_input(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> JSONResponse:
    resolved = await resolve_session_id(session_id)
    categories, metadata = await load_module4_input_data(resolved)
    return JSONResponse({
        "session_id": resolved,
        "metadata": metadata,
        "categories": categories,
    })


@app.get("/api/output")
async def get_output(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> JSONResponse:
    resolved = await resolve_session_id(session_id)
    categories, metadata = await load_module4_input_data(resolved)
    enrichment = await load_enrichment_data(resolved)
    debate_payload = await load_debate_data(resolved)

    return JSONResponse({
        "session_id": resolved,
        "metadata": metadata,
        "categories": categories,
        "enrichment": enrichment,
        "debate": debate_payload,
    })


@app.get("/api/status")
async def get_status(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    categories, _ = await load_module4_input_data(resolved)
    enrichment = await load_enrichment_data(resolved)
    debate_payload = await load_debate_data(resolved)

    total_links = 0
    summary: Optional[Dict[str, Dict[str, int]]] = None
    if enrichment:
        results = enrichment.get("results", enrichment)
        if isinstance(results, dict):
            total_links, summary = compute_enrichment_summary(results)

    trust_score = None
    generated_at = None
    if debate_payload:
        trust_score = debate_payload.get("trust_score")
        generated_at = debate_payload.get("generated_at")

    input_available = any(categories[key] for key in CATEGORY_KEYS)

    return {
        "session_id": resolved,
        "input_available": input_available,
        "enrichment": {
            "available": bool(enrichment),
            "total_relevant_links": total_links,
            "summary": summary,
        },
        "debate": {
            "available": bool(debate_payload),
            "trust_score": trust_score,
            "generated_at": generated_at,
        },
    }


@app.post("/upload-perspectives")
async def upload_perspectives(request: UploadPerspectivesRequest) -> Dict[str, Any]:
    resolved = await resolve_session_id(request.session_id)

    payload = {
        "session_id": resolved,
        "received_at": iso_now(),
        "source": request.source or "module3",
        "topic": request.topic,
        "context_text": request.context_text,
        "categories": {
            "leftist": request.leftist,
            "rightist": request.rightist,
            "common": request.common,
        },
    }

    if request.metadata:
        payload["metadata"] = request.metadata

    await save_module_result(
        session_id=resolved,
        module_name=MODULE4_INPUT_NAME,
        payload=payload,
        status="ready",
    )

    await clear_debate_cache(resolved)

    counts = {
        "leftist": len(request.leftist),
        "rightist": len(request.rightist),
        "common": len(request.common),
    }
    counts["total"] = sum(counts.values())

    return {
        "status": "success",
        "message": "Perspective payload stored",
        "session_id": resolved,
        "counts": counts,
    }


@app.post("/api/enrich-perspectives")
async def enrich_perspectives(
    session_id: str = Query(..., description="Pipeline session identifier"),
    force: bool = Query(False),
    topic_override: Optional[str] = Query(None, alias="topic"),
    context_override: Optional[str] = Query(None, alias="context"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    existing = await load_enrichment_data(resolved)

    if existing and not force:
        results = existing.get("results", existing)
        if isinstance(results, dict):
            total_links, summary = compute_enrichment_summary(results)
        else:
            total_links, summary = 0, None
        return {
            "status": "cached",
            "message": "Existing enrichment data reused",
            "session_id": resolved,
            "total_relevant_links": total_links,
            "summary": summary,
        }

    categories, metadata = await load_module4_input_data(resolved)
    if not any(categories[key] for key in CATEGORY_KEYS):
        raise HTTPException(status_code=404, detail="No perspective data available for enrichment.")

    topic = topic_override or metadata.get("topic") or derive_topic(metadata, categories)
    context_text = context_override or derive_context(metadata)

    try:
        system = RelevanceSearchSystem(
            data_dir=str(DATA_DIR),
            perspective_payload=categories,
            topic=topic,
            context_text=context_text,
            force_refresh=force,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to initialize relevance search: %s", exc)
        raise HTTPException(status_code=503, detail=f"Relevance search unavailable: {exc}") from exc

    try:
        results = await asyncio.to_thread(system.process_all_files)
    finally:
        await asyncio.to_thread(system.cleanup)

    total_links, summary = compute_enrichment_summary(results)

    payload = {
        "session_id": resolved,
        "processed_at": iso_now(),
        "topic": topic,
        "context_text": context_text,
        "results": results,
        "total_relevant_links": total_links,
        "summary": summary,
    }

    await save_module_result(
        session_id=resolved,
        module_name=MODULE4_ENRICHMENT_NAME,
        payload=payload,
        status="completed",
    )

    return {
        "status": "completed",
        "message": "Perspectives enriched successfully",
        "session_id": resolved,
        "total_relevant_links": total_links,
        "summary": summary,
    }


@app.get("/api/enrichment-result")
async def get_enrichment_result(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    payload = await load_enrichment_data(resolved)
    if not payload:
        raise HTTPException(status_code=404, detail="Enrichment data not available.")

    return {
        "status": "completed",
        "session_id": resolved,
        "total_relevant_links": payload.get("total_relevant_links", 0),
        "summary": payload.get("summary", {}),
        "results": payload.get("results"),
    }


@app.get("/api/enrichment-items")
async def get_enrichment_items(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    payload = await load_enrichment_data(resolved)
    if not payload:
        raise HTTPException(status_code=404, detail="Enrichment data not available.")

    items = flatten_enrichment_items_from_payload(payload)
    return {
        "status": "completed",
        "session_id": resolved,
        "items": items,
        "total_items": len(items),
    }


@app.post("/api/debate")
async def start_debate(
    session_id: str = Query(..., description="Pipeline session identifier"),
    use_enriched: bool = Query(True),
    max_rounds: int = Query(7, ge=1, le=10),
    min_rounds: int = Query(6, ge=1, le=9),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    categories, metadata = await load_module4_input_data(resolved)
    if not any(categories[key] for key in CATEGORY_KEYS):
        raise HTTPException(status_code=404, detail="No perspective data available for debate.")

    enrichment_payload = await load_enrichment_data(resolved) if use_enriched else None
    if enrichment_payload:
        enriched_sets = extract_enriched_perspectives(enrichment_payload)
        if any(enriched_sets[key] for key in CATEGORY_KEYS):
            selected = enriched_sets
        else:
            selected = categories
    else:
        selected = categories

    topic = metadata.get("topic") or derive_topic(metadata, categories)

    try:
        orchestrator = DebateOrchestrator()
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to initialize debate orchestrator: %s", exc)
        raise HTTPException(status_code=503, detail=f"Debate orchestrator unavailable: {exc}") from exc

    try:
        await update_session_status(resolved, "module4_processing")
    except SessionNotFoundError:
        logger.warning("Session %s missing when updating status to module4_processing", resolved)

    try:
        result = await asyncio.to_thread(
            orchestrator.conduct_debate,
            selected.get("leftist", []),
            selected.get("rightist", []),
            selected.get("common", []),
            max_rounds,
            min_rounds,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Debate execution failed: %s", exc)
        try:
            await update_session_status(resolved, "module3_completed")
        except SessionNotFoundError:
            pass
        raise HTTPException(status_code=500, detail=f"Debate failed: {exc}") from exc

    payload = {
        "session_id": resolved,
        "generated_at": iso_now(),
        "topic": topic,
        "used_enriched": bool(enrichment_payload),
        "trust_score": result.get("trust_score"),
        "judgment": result.get("judgment"),
        "debate_transcript": result.get("debate_transcript", []),
        "total_rounds": result.get("total_rounds"),
        "final_verdict": result.get("final_verdict"),
    }

    await save_module_result(
        session_id=resolved,
        module_name=MODULE4_DEBATE_NAME,
        payload=payload,
        status="completed",
    )

    await set_debate_cache(resolved, payload)

    try:
        await update_session_status(resolved, "module4_completed")
    except SessionNotFoundError:
        logger.warning("Session %s missing when updating status to module4_completed", resolved)

    response = {
        "status": "completed",
        "message": "Debate completed successfully",
        "session_id": resolved,
        "trust_score": payload.get("trust_score"),
        "judgment": payload.get("judgment"),
        "topic": payload.get("topic"),
        "debate_transcript": payload.get("debate_transcript"),
        "final_verdict": payload.get("final_verdict"),
        "debate_file": None,
    }

    return response


@app.get("/api/debate/result")
async def get_debate_result(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    cached = await get_debate_cache(resolved)
    if cached:
        payload = cached
    else:
        payload = await load_debate_data(resolved)
        if not payload:
            raise HTTPException(status_code=404, detail="Debate result not available.")
        await set_debate_cache(resolved, payload)

    return {
        "status": "completed",
        "session_id": resolved,
        "trust_score": payload.get("trust_score"),
        "judgment": payload.get("judgment"),
        "topic": payload.get("topic"),
        "debate_transcript": payload.get("debate_transcript"),
        "final_verdict": payload.get("final_verdict"),
    }


@app.get("/api/debate-messages")
async def get_debate_messages_endpoint(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    cached = await get_debate_cache(resolved)
    if cached:
        payload = cached
    else:
        payload = await load_debate_data(resolved)
        if not payload:
            raise HTTPException(status_code=404, detail="Debate transcript not available.")
        await set_debate_cache(resolved, payload)

    messages = build_debate_messages(payload)
    return {
        "status": "completed",
        "session_id": resolved,
        "messages": messages,
        "total_messages": len(messages),
    }


@app.get("/api/debate-summary")
async def get_debate_summary(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    cached = await get_debate_cache(resolved)
    if cached:
        payload = cached
    else:
        payload = await load_debate_data(resolved)
        if not payload:
            raise HTTPException(status_code=404, detail="Debate summary not available.")
        await set_debate_cache(resolved, payload)

    return {
        "status": "completed",
        "session_id": resolved,
        "summary": {
            "trust_score": payload.get("trust_score"),
            "judgment": payload.get("judgment"),
            "topic": payload.get("topic"),
            "total_rounds": payload.get("total_rounds"),
            "generated_at": payload.get("generated_at"),
            "final_verdict": payload.get("final_verdict"),
        },
    }


@app.post("/api/clear")
async def clear_session_data(
    session_id: str = Query(..., description="Pipeline session identifier"),
    preserve_input: bool = Query(False),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    modules = [MODULE4_ENRICHMENT_NAME, MODULE4_DEBATE_NAME]
    if not preserve_input:
        modules.append(MODULE4_INPUT_NAME)

    deleted = await delete_module_records(resolved, modules)
    await clear_debate_cache(resolved)

    return {
        "status": "success",
        "session_id": resolved,
        "modules_cleared": modules,
        "rows_affected": deleted,
    }


@app.get("/api/enrichment-status")
async def enrichment_status(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    payload = await load_enrichment_data(resolved)
    status_info = {
        "status": "completed" if payload else "idle",
        "message": "Enrichment completed" if payload else "No enrichment data",
    }
    return {"running": False, "status": status_info, "session_id": resolved}


@app.get("/api/debate-status")
async def debate_status(
    session_id: str = Query(..., description="Pipeline session identifier"),
) -> Dict[str, Any]:
    resolved = await resolve_session_id(session_id)
    payload = await load_debate_data(resolved)
    status_info = {
        "status": "completed" if payload else "idle",
        "message": "Debate completed" if payload else "No debate data",
    }
    return {"running": False, "status": status_info, "session_id": resolved}


def _resolve_bind() -> tuple[str, int]:
    port_env = os.getenv("PORT")
    if port_env:
        return "0.0.0.0", int(port_env)
    if config:
        return config.get_module4_host(), config.get_module4_port()
    return os.getenv("HOST", "0.0.0.0"), int(os.getenv("MODULE4_PORT", 8004))


def _run_server() -> None:  # pragma: no cover - manual execution helper
    import uvicorn

    host, port = _resolve_bind()
    logger.info("Starting Module 4 server on %s:%s", host, port)
    logger.info("Waiting for perspective data from Module 3...")

    config_obj = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="info",
    )
    server = uvicorn.Server(config_obj)

    if sys.platform.startswith("win"):
        # Force selector loop via Runner to avoid Proactor incompatibility in psycopg.
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception as loop_error:  # pragma: no cover - defensive guard
            logger.debug("Event loop policy setup skipped during launch: %s", loop_error)

        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(server.serve())
    else:
        asyncio.run(server.serve())


if __name__ == "__main__":  # pragma: no cover - manual execution
    _run_server()
