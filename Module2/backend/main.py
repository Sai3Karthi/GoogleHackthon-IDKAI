"""Module 2 service for classification and significance scoring."""

import os
import sys

if sys.platform.startswith("win"):
    os.environ.setdefault("PYTHONASYNCIO_USE_SELECTOR", "1")

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

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

from database import (  # type: ignore  # added after sys.path update
    initialize_database_schema,
    get_async_session,
    get_module_result,
    get_pipeline_session,
    save_module_result,
    update_session_status,
    ModuleResultNotFoundError,
    PipelineSession,
    SessionNotFoundError,
)

from Modules.Classifier.classifier import FakeNewsDetector
from Modules.Summarizer.summarizer import ComprehensiveSummarizer

if config:
    HOST = config.get_module2_host()
    PORT = config.get_module2_port()
    frontend_port = config.get_frontend_port()
    frontend_url = config.get_frontend_url()
else:
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = int(os.getenv("MODULE2_PORT", 8002))
    frontend_port = int(os.getenv("FRONTEND_PORT", 3000))
    frontend_url = os.getenv("FRONTEND_URL", f"http://localhost:{frontend_port}")

APP_TITLE = "Module 2: Information Classification"
APP_DESCRIPTION = "Classify information and assign significance scores based on Module 1 analysis"
APP_VERSION = "1.0.0"

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("MODULE2_MODEL", os.getenv("MODEL_NAME", "gemini-2.5-flash"))

if not API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable is required in root .env")

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

port_override = os.getenv("PORT")
if port_override:
    PORT = int(port_override)
    HOST = "0.0.0.0"

allowed_origins: List[str] = []
if config:
    allowed_origins.append(config.get_frontend_url())
    frontend_port = config.get_frontend_port()
    allowed_origins.extend(
        [
            f"http://localhost:{frontend_port}",
            f"http://127.0.0.1:{frontend_port}",
        ]
    )
else:
    allowed_origins = [
        frontend_url,
        f"http://localhost:{frontend_port}",
        f"http://127.0.0.1:{frontend_port}",
    ]


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Module2 server starting up...")
    try:
        initialize_database_schema()
        logger.info("Database schema ensured")
    except Exception as db_error:  # pylint: disable=broad-except
        logger.error("Failed to initialize database schema: %s", db_error)
        raise
    yield
    logger.info("Module2 server shutting down...")


app = FastAPI(
    title=APP_TITLE,
    description=APP_DESCRIPTION,
    version=APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

classifier = FakeNewsDetector(API_KEY, MODEL_NAME)
summarizer = ComprehensiveSummarizer(API_KEY, MODEL_NAME)

logger.info("Module 2 initialized with model %s", MODEL_NAME)


# Pydantic models for request/response
class ClassificationBreakdown(BaseModel):
    person: float
    organization: float
    social: float
    critical: float
    stem: float

class DetailedAnalysis(BaseModel):
    classification: ClassificationBreakdown
    classification_reasoning: str
    classification_confidence: float
    significance_score: int
    significance_explanation: str
    comprehensive_summary: str
    requires_debate: bool
    debate_priority: str

class Module2Output(BaseModel):
    detailed_analysis: DetailedAnalysis
    module1_confidence: float
    module1_risk_level: str
    module1_threats: List[str]
    timestamp: str


class Module3Input(BaseModel):
    topic: str
    text: str
    significance_score: float


class ProcessRequest(BaseModel):
    session_id: str = Field(
        ...,
        description="Pipeline session identifier generated by Module 1",
    )

def calculate_significance_score(confidence: float, risk_level: str, threats: List[str]) -> tuple[int, str]:
    """
    Calculate significance score based on Module 1's confidence.
    INVERSE RELATIONSHIP: Lower confidence (less obvious) = Higher significance (needs more debate)
    
    Logic:
    - 95-100% confidence (obvious scam): 10-20 score (low significance, already clear)
    - 80-94% confidence (likely scam): 30-50 score (medium significance)
    - 60-79% confidence (suspicious): 60-75 score (high significance, needs debate)
    - 40-59% confidence (unclear): 80-90 score (very high significance, critical debate needed)
    - 0-39% confidence (safe): 5-15 score (low significance, likely safe)
    
    Returns: (score: int, explanation: str)
    """
    confidence_percent = confidence * 100
    
    # Handle high confidence dangerous content
    if confidence_percent >= 95 and risk_level == "dangerous":
        score = int(15 - (confidence_percent - 95) * 1.0)
        explanation = f"Obvious threat with {confidence_percent:.1f}% confidence. Minimal debate needed as the threat is clear."
        
    elif confidence_percent >= 80 and risk_level == "dangerous":
        score = int(30 + (95 - confidence_percent) * 1.3)
        explanation = f"Likely threat with {confidence_percent:.1f}% confidence. Moderate debate needed to explore nuances."
        
    elif confidence_percent >= 60:
        score = int(60 + (80 - confidence_percent) * 0.75)
        explanation = f"Suspicious content with {confidence_percent:.1f}% confidence. High debate significance as interpretation varies."
        
    elif confidence_percent >= 40:
        score = int(80 + (60 - confidence_percent) * 0.5)
        explanation = f"Ambiguous content with {confidence_percent:.1f}% confidence. Critical debate needed to determine true nature."
        
    else:
        score = int(5 + (40 - confidence_percent) * 0.25)
        explanation = f"Low threat confidence ({confidence_percent:.1f}%). Minimal significance for debate."
    
    # Boost score if multiple threats detected
    if len(threats) >= 3:
        score = min(100, score + 10)
        explanation += f" Multiple threats detected ({len(threats)}), increasing debate priority."
    
    return min(100, max(0, score)), explanation


# Helper utilities


def determine_debate_priority(score: int) -> str:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 30:
        return "medium"
    return "low"


async def fetch_session_or_404(session_id: str) -> PipelineSession:
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    try:
        return await get_pipeline_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found") from exc


async def fetch_session_for_processing(session_id: str) -> PipelineSession:
    session_record = await fetch_session_or_404(session_id)
    if session_record.status not in {"module1_completed", "module2_processing"}:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Session {session_id} is in status '{session_record.status}' "
                "and cannot be processed by Module 2."
            ),
        )
    return session_record


async def load_module1_output(session_id: str) -> Dict[str, Any]:
    try:
        module1_result = await get_module_result(session_id, "module1")
    except ModuleResultNotFoundError as exc:
        raise HTTPException(
            status_code=404, detail="Module 1 output not found for the requested session."
        ) from exc
    return module1_result.payload or {}


def extract_original_text(session_record: PipelineSession, module1_payload: Dict[str, Any]) -> str:
    metadata = session_record.input_metadata or {}
    analysis_details = module1_payload.get("analysis_details")
    if not isinstance(analysis_details, dict):
        analysis_details = {}

    candidates = [
        metadata.get("text"),
        metadata.get("content"),
        metadata.get("input_text"),
        module1_payload.get("scraped_text"),
        module1_payload.get("extracted_text"),
        module1_payload.get("ai_reasoning"),
        analysis_details.get("scraped_text"),
        analysis_details.get("content"),
        analysis_details.get("body"),
    ]

    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

    url_candidate = metadata.get("url") or module1_payload.get("url")
    if isinstance(url_candidate, str) and url_candidate.strip():
        return url_candidate.strip()

    raise HTTPException(
        status_code=400,
        detail="No text content available from Module 1 results for classification.",
    )


def prepare_module3_input(
    original_text: str,
    summary_text: str,
    significance_score: int,
) -> Module3Input:
    topic = summary_text if len(summary_text) <= 200 else f"{summary_text[:200]}..."
    return Module3Input(
        topic=topic,
        text=original_text,
        significance_score=significance_score / 100.0,
    )


def build_detailed_analysis(
    classification_result,
    significance_score: int,
    significance_explanation: str,
    summary_text: str,
) -> DetailedAnalysis:
    breakdown = ClassificationBreakdown(
        person=classification_result.person,
        organization=classification_result.organization,
        social=classification_result.social,
        critical=classification_result.critical,
        stem=classification_result.stem,
    )

    requires_debate = significance_score >= 50
    return DetailedAnalysis(
        classification=breakdown,
        classification_reasoning=classification_result.reasoning,
        classification_confidence=classification_result.confidence_score,
        significance_score=significance_score,
        significance_explanation=significance_explanation,
        comprehensive_summary=summary_text,
        requires_debate=requires_debate,
        debate_priority=determine_debate_priority(significance_score),
    )


def build_module2_output(
    detailed_analysis: DetailedAnalysis,
    confidence: float,
    risk_level: str,
    threats: List[str],
) -> Module2Output:
    return Module2Output(
        detailed_analysis=detailed_analysis,
        module1_confidence=confidence,
        module1_risk_level=risk_level,
        module1_threats=threats,
        timestamp=datetime.now().isoformat(),
    )


@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "message": APP_TITLE,
        "version": APP_VERSION,
        "requires_session_id": True,
        "endpoints": {
            "POST /api/process": "Process Module 1 output by session",
            "GET /api/input": "Retrieve Module 1 output for a session",
            "GET /api/output": "Retrieve Module 2 output for a session",
            "GET /api/status": "Inspect module state and data availability",
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

    return {
        "status": "healthy" if db_status == "reachable" else "degraded",
        "message": "Module 2 Classification Service",
        "model": MODEL_NAME,
        "database": db_status,
        "port": PORT,
    }


@app.get("/api/input")
async def get_module1_output(
    session_id: str = Query(..., description="Pipeline session identifier from Module 1"),
) -> JSONResponse:
    session_record = await fetch_session_or_404(session_id)
    module1_payload = await load_module1_output(str(session_record.id))
    return JSONResponse(module1_payload)


@app.get("/api/output")
async def get_module2_output(
    session_id: str = Query(..., description="Pipeline session identifier from Module 1"),
) -> JSONResponse:
    session_record = await fetch_session_or_404(session_id)
    try:
        module2_result = await get_module_result(session_record.id, "module2")
    except ModuleResultNotFoundError as exc:
        raise HTTPException(
            status_code=404, detail="Module 2 output not available for the requested session."
        ) from exc

    return JSONResponse(module2_result.payload)


@app.get("/api/status")
async def get_status(
    session_id: str = Query(..., description="Pipeline session identifier from Module 1"),
) -> Dict[str, Any]:
    session_record = await fetch_session_or_404(session_id)

    module1_available = False
    module2_available = False
    try:
        await get_module_result(session_record.id, "module1")
        module1_available = True
    except ModuleResultNotFoundError:
        module1_available = False
    try:
        await get_module_result(session_record.id, "module2")
        module2_available = True
    except ModuleResultNotFoundError:
        module2_available = False

    return {
        "service": "module2",
        "status": "ready" if module1_available else "awaiting_module1",
        "session_available": True,
        "module1_output_available": module1_available,
        "module2_output_available": module2_available,
    }


@app.post("/api/process")
async def process_module1_output(request: ProcessRequest) -> Module2Output:
    session_record = await fetch_session_for_processing(request.session_id)
    session_id_str = str(session_record.id)

    logger.info("Processing session %s", session_id_str)
    await update_session_status(session_record.id, "module2_processing")

    try:
        module1_payload = await load_module1_output(session_id_str)
        original_text = extract_original_text(session_record, module1_payload)

        confidence = float(module1_payload.get("confidence", 0.5))
        risk_level = str(module1_payload.get("risk_level", "unknown"))
        threats = module1_payload.get("threats") or []

        logger.info("Classifying content (length=%s)", len(original_text))
        try:
            classification_result = await asyncio.to_thread(classifier.classify, original_text)
        except Exception as exc:  # pylint: disable=broad-except
            error_msg = str(exc)
            if any(token in error_msg for token in ("403", "Permission", "leaked")):
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "API Key Error: Your Google API key was reported as leaked and has been disabled. "
                        "Please generate a new key and update GEMINI_API_KEY."
                    ),
                ) from exc
            raise HTTPException(status_code=500, detail=f"Classification failed: {error_msg}") from exc

        if not classification_result:
            raise HTTPException(status_code=500, detail="Classification failed to produce a result")

        significance_score, significance_explanation = calculate_significance_score(
            confidence, risk_level, threats
        )

        logger.info("Generating summary for session %s", session_id_str)
        try:
            summary_result = await asyncio.to_thread(summarizer.summarize, original_text)
        except Exception as exc:  # pylint: disable=broad-except
            error_msg = str(exc)
            if any(token in error_msg for token in ("403", "Permission", "leaked")):
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "API Key Error: Your Google API key was reported as leaked and has been disabled. "
                        "Please generate a new key and update GEMINI_API_KEY."
                    ),
                ) from exc
            raise HTTPException(status_code=500, detail=f"Summarization failed: {error_msg}") from exc

        if not summary_result:
            raise HTTPException(status_code=500, detail="Summarization failed to produce a result")

        detailed_analysis = build_detailed_analysis(
            classification_result,
            significance_score,
            significance_explanation,
            summary_result.comprehensive_summary,
        )

        module2_output = build_module2_output(
            detailed_analysis,
            confidence,
            risk_level,
            threats,
        )

        module3_input = prepare_module3_input(
            original_text,
            summary_result.comprehensive_summary,
            significance_score,
        )

        await save_module_result(
            session_id=session_record.id,
            module_name="module2",
            payload=module2_output.model_dump(),
            status="completed",
        )

        await save_module_result(
            session_id=session_record.id,
            module_name="module3_input",
            payload=module3_input.model_dump(),
            status="ready",
        )

        await update_session_status(session_record.id, "module2_completed")
        logger.info(
            "Module 2 processing complete for session %s (significance=%s)",
            session_id_str,
            significance_score,
        )
        return module2_output

    except HTTPException:
        await update_session_status(session_record.id, "module1_completed")
        raise
    except Exception as exc:  # pylint: disable=broad-except
        await update_session_status(session_record.id, "module1_completed")
        logger.exception("Module 2 processing failed for session %s", session_id_str)
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting Module 2 server on %s:%s", HOST, PORT)

    async def _serve() -> None:
        config_obj = uvicorn.Config(app, host=HOST, port=PORT, log_level="info")
        server = uvicorn.Server(config_obj)
        await server.serve()

    asyncio.run(_serve())
