"""Module1 FastAPI server for link verification and scam detection."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import os
import sys

if sys.platform.startswith("win"):
    os.environ.setdefault("PYTHONASYNCIO_USE_SELECTOR", "1")

import asyncio
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

try:
    root = Path(__file__).parent.parent.parent
    sys.path.insert(0, str(root))
    from utils.env_loader import load_env_file
    env_path = root / '.env'
    if load_env_file(env_path):
        logger.info(f"Environment variables loaded from {env_path}")
except (ImportError, ValueError):
    try:
        from dotenv import load_dotenv
        env_path = Path(__file__).parent.parent.parent / '.env'
        load_dotenv(env_path)
    except ImportError:
        logger.info("Using system environment variables")

try:
    root_path = Path(__file__).parent.parent.parent
    sys.path.insert(0, str(root_path))
    from config_loader import get_config
    config = get_config()
    logger.info("Configuration loaded successfully")
except Exception as e:
    logger.warning(f"Could not load config: {e}. Using defaults.")
    config = None

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from typing import Optional, List, Dict, Any
import json
import httpx
from sqlalchemy import select

from scraper import scrape_url, detect_input_type
from analyzer import analyze_content, quick_url_check, gemini_analyze_image
from validators import validate_url_safety
from image_utils import (
    validate_and_process_image_url,
    process_image_bytes,
    validate_base64_image,
    get_image_mime_type
)

from database import (
    create_pipeline_session,
    save_module_result,
    mark_session_completed,
    mark_session_skip,
    get_async_session,
    initialize_database_schema,
    get_pipeline_session,
    get_module_result,
    SessionNotFoundError,
    ModuleResultNotFoundError,
)
from database.models import ModuleResult, PipelineSession

CONFIG_PATH = Path(__file__).parent / "config.json"
with open(CONFIG_PATH, "r") as f:
    SCAM_CONFIG = json.load(f)

MODULE_NAME = "module1"


def _current_timestamp() -> str:
    """Return current UTC timestamp as ISO string."""
    return datetime.now(timezone.utc).isoformat()


async def persist_session_data(
    *,
    input_payload: Dict[str, Any],
    output_payload: Dict[str, Any],
    input_type: str,
    analysis_mode: str,
    raw_text: Optional[str],
    input_url: Optional[str],
    skip_to_final: bool,
    skip_reason: Optional[str],
) -> str:
    """Persist analysis input/output in the shared database."""
    session_record = await create_pipeline_session(
        analysis_mode=analysis_mode,
        input_type=input_type,
        input_text=raw_text,
        input_url=input_url,
        input_metadata=input_payload,
        status="skipped" if skip_to_final else "module1_processing",
    )

    await save_module_result(
        session_id=session_record.id,
        module_name=MODULE_NAME,
        payload=output_payload,
        status="completed",
    )

    if skip_to_final:
        await mark_session_skip(
            session_record.id,
            skip_to_final=True,
            skip_reason=skip_reason,
            status="skipped",
        )
    else:
        await mark_session_completed(session_record.id, status="module1_completed")

    return str(session_record.id)


async def fetch_latest_session() -> Optional[PipelineSession]:
    """Fetch the most recent pipeline session handled by Module 1."""
    async with get_async_session() as session:
        result = await session.execute(
            select(PipelineSession).order_by(PipelineSession.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()


async def fetch_latest_module_result() -> Optional[ModuleResult]:
    """Fetch the most recent Module 1 result payload."""
    async with get_async_session() as session:
        result = await session.execute(
            select(ModuleResult)
            .where(ModuleResult.module_name == MODULE_NAME)
            .order_by(ModuleResult.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()


async def has_any_session() -> bool:
    return (await fetch_latest_session()) is not None


async def has_any_module_result() -> bool:
    return (await fetch_latest_module_result()) is not None

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Module1 server starting up...")
    try:
        initialize_database_schema()
        logger.info("Database schema ensured")
    except Exception as db_error:
        logger.error(f"Failed to prepare database schema: {db_error}")
        raise
    yield
    logger.info("Module1 server shutting down...")

app = FastAPI(
    title="Module1 Link Verification API",
    version="1.0.0",
    description="API for link verification and scam detection",
    lifespan=lifespan
)

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
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Background task to trigger Module 2 and then Module 3
async def trigger_pipeline_background(session_id: str):
    """Trigger Module 2 and Module 3 in background without blocking Module 1 response."""
    try:
        # Small delay to ensure files are written
        await asyncio.sleep(0.5)

        module2_base = config.get_module2_url() if config else f"http://127.0.0.1:{os.getenv('MODULE2_PORT', '8002')}"
        module2_endpoint = f"{module2_base.rstrip('/')}/api/process"
        logger.info(f"[Background] Triggering Module 2 at {module2_endpoint} for session {session_id}")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    module2_endpoint,
                    json={"session_id": session_id},
                    timeout=60.0,
                )

                if response.status_code == 200:
                    logger.info("[Background] Module 2 processing completed successfully")

                    await asyncio.sleep(1)

                    module3_base = config.get_module3_url() if config else f"http://127.0.0.1:{os.getenv('MODULE3_PORT', '8003')}"
                    module3_endpoint = f"{module3_base.rstrip('/')}/api/run_pipeline_stream"
                    logger.info(f"[Background] Triggering Module 3 at {module3_endpoint}")

                    response3 = await client.post(
                        module3_endpoint,
                        json={
                            "session_id": session_id,
                            "send_to_module4": False,
                        },
                        timeout=120.0,
                    )
                    if response3.status_code == 200:
                        logger.info("[Background] Module 3 processing triggered successfully")
                    else:
                        logger.warning(f"[Background] Module 3 returned status {response3.status_code}")
                else:
                    logger.warning(f"[Background] Module 2 returned status {response.status_code}")
        except httpx.ConnectError as e:
            logger.error(f"[Background] Connection error: {e}")
        except Exception as e:
            logger.error(f"[Background] Error in pipeline: {type(e).__name__}: {e}")

    except Exception as e:
        logger.error(f"[Background] Fatal error in background task: {e}")


def start_background_pipeline(session_id: str):
    """Start the pipeline in background (fire and forget)."""
    try:
        asyncio.create_task(trigger_pipeline_background(session_id))
        logger.info(f"Background pipeline task created for session {session_id}")
    except Exception as e:
        logger.error(f"Failed to create background task: {e}")

class AnalyzeRequest(BaseModel):
    input: str
    deep_scan: Optional[bool] = False
    
    @validator('input')
    def input_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Input cannot be empty')
        return v.strip()

class AnalyzeImageRequest(BaseModel):
    image: str
    image_type: str = "base64"
    context_text: Optional[str] = None
    url: Optional[str] = None
    
    @validator('image')
    def image_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Image data cannot be empty')
        return v.strip()
    
    @validator('image_type')
    def valid_image_type(cls, v):
        if v not in ["base64", "url"]:
            raise ValueError('image_type must be "base64" or "url"')
        return v

class AnalysisResult(BaseModel):
    session_id: str
    input_type: str
    risk_level: str
    confidence: float
    threats: List[str]
    analysis: Dict[str, Any]
    recommendation: str
    scraped_content: Optional[Dict[str, str]] = None
    ai_powered: Optional[bool] = False
    image_info: Optional[Dict[str, Any]] = None
    skip_to_final: Optional[bool] = False
    skip_reason: Optional[str] = None

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Module1 Link Verification",
        "version": "1.0.0"
    }

def should_skip_to_final_output(risk_level: str, confidence: float, threats: List[str], input_type: str) -> tuple[bool, str]:
    """
    Determine if we should skip to Module 5 (final output) based on analysis results.
    
    Skip conditions:
    1. Dangerous content with very high confidence (>= 0.95)
    2. Multiple critical threats detected with high confidence
    3. AI-generated fake image detected with very high confidence
    
    Returns: (should_skip: bool, reason: str)
    """
    if risk_level == "dangerous" and confidence >= 0.85:
        if len(threats) >= 3:
            return True, "Multiple critical threats detected with high confidence. No debate needed."
        
        critical_threats = [
            "phishing", "malware", "financial_scam", "social_engineering",
            "google_web_risk_flagged", "fake_qr_code", "manipulated_image",
            "deepfake", "fake_payment_confirmation"
        ]
        
        detected_critical = [t for t in threats if t in critical_threats]
        if len(detected_critical) >= 2:
            return True, f"Critical threats detected: {', '.join(detected_critical)}. Obvious scam/fake content."
    
    if input_type == "image" and confidence >= 0.90:
        fake_image_indicators = ["manipulated_image", "deepfake", "fake_screenshot", "photoshopped"]
        if any(threat in threats for threat in fake_image_indicators):
            return True, "AI-generated or manipulated image detected with high confidence."
    
    return False, ""

@app.post("/api/analyze", response_model=AnalysisResult)
async def analyze_input(request: AnalyzeRequest):
    analysis_mode = "deep_scan" if request.deep_scan else "standard"
    try:
        input_text = request.input
        input_type = detect_input_type(input_text)
        
        if input_type == "url":
            quick_check = await quick_url_check(input_text)
            if quick_check["is_malicious"]:
                skip_reason = "Known malicious URL detected by quick scan."
                input_payload = {
                    "type": "url",
                    "url": input_text,
                    "timestamp": _current_timestamp(),
                }
                output_payload = {
                    "input_type": "url",
                    "risk_level": "dangerous",
                    "confidence": 0.95,
                    "threats": quick_check["threats"],
                    "recommendation": "DO NOT VISIT THIS SITE. Known malicious URL detected.",
                    "analysis_details": quick_check,
                    "ai_powered": False,
                    "skip_to_final": True,
                    "skip_reason": skip_reason,
                    "timestamp": _current_timestamp(),
                }

                session_id = await persist_session_data(
                    input_payload=input_payload,
                    output_payload=output_payload,
                    input_type="url",
                    analysis_mode=analysis_mode,
                    raw_text=None,
                    input_url=input_text,
                    skip_to_final=True,
                    skip_reason=skip_reason,
                )

                return AnalysisResult(
                    session_id=session_id,
                    input_type="url",
                    risk_level="dangerous",
                    confidence=0.95,
                    threats=quick_check["threats"],
                    analysis=quick_check,
                    recommendation="DO NOT VISIT THIS SITE. Known malicious URL detected.",
                    scraped_content=None,
                    skip_to_final=True,
                    skip_reason=skip_reason,
                )
            
            scraped = await scrape_url(input_text)
            
            if scraped["success"]:
                analysis = await analyze_content(
                    scraped["title"],
                    scraped["text"],
                    input_text,
                    SCAM_CONFIG
                )
                
                skip_to_final, skip_reason = should_skip_to_final_output(
                    analysis["risk_level"],
                    analysis["confidence"],
                    analysis["threats"],
                    "url"
                )
                analysis_details = dict(analysis.get("details", {}))

                input_payload = {
                    "type": "url",
                    "url": input_text,
                    "timestamp": _current_timestamp(),
                }

                output_payload = {
                    "input_type": "url",
                    "risk_level": analysis["risk_level"],
                    "confidence": analysis["confidence"],
                    "threats": analysis["threats"],
                    "recommendation": analysis["recommendation"],
                    "scraped_title": scraped["title"],
                    "scraped_text": scraped["text"],
                    "ai_powered": analysis.get("ai_powered", False),
                    "analysis_details": analysis_details,
                    "skip_to_final": skip_to_final,
                    "skip_reason": skip_reason if skip_to_final else None,
                    "timestamp": _current_timestamp(),
                }

                session_id = await persist_session_data(
                    input_payload=input_payload,
                    output_payload=output_payload,
                    input_type="url",
                    analysis_mode=analysis_mode,
                    raw_text=None,
                    input_url=input_text,
                    skip_to_final=skip_to_final,
                    skip_reason=skip_reason if skip_to_final else None,
                )

                if skip_to_final:
                    logger.info("Skipping to Module 5 (final output) - high confidence detected")
                else:
                    logger.info("Starting background pipeline (Module 2 → Module 3)")
                    start_background_pipeline(session_id)

                result = AnalysisResult(
                    session_id=session_id,
                    input_type="url",
                    risk_level=analysis["risk_level"],
                    confidence=analysis["confidence"],
                    threats=analysis["threats"],
                    analysis=analysis_details,
                    recommendation=analysis["recommendation"],
                    scraped_content={
                        "title": scraped["title"],
                        "text": scraped["text"][:500] + "..." if len(scraped["text"]) > 500 else scraped["text"]
                    },
                    ai_powered=analysis.get("ai_powered", False),
                    skip_to_final=skip_to_final,
                    skip_reason=skip_reason if skip_to_final else None
                )
                
                return result
            else:
                url_analysis = await validate_url_safety(input_text, SCAM_CONFIG)
                analysis_details = dict(url_analysis)

                input_payload = {
                    "type": "url",
                    "url": input_text,
                    "timestamp": _current_timestamp(),
                }

                output_payload = {
                    "input_type": "url",
                    "risk_level": url_analysis["risk_level"],
                    "confidence": 0.6,
                    "threats": url_analysis["threats"],
                    "recommendation": url_analysis["recommendation"],
                    "scraping_failed": True,
                    "analysis_details": analysis_details,
                    "skip_to_final": False,
                    "skip_reason": None,
                    "timestamp": _current_timestamp(),
                }

                session_id = await persist_session_data(
                    input_payload=input_payload,
                    output_payload=output_payload,
                    input_type="url",
                    analysis_mode=analysis_mode,
                    raw_text=None,
                    input_url=input_text,
                    skip_to_final=False,
                    skip_reason=None,
                )
                logger.info("Starting background pipeline (Module 2 → Module 3)")
                start_background_pipeline(session_id)

                result = AnalysisResult(
                    session_id=session_id,
                    input_type="url",
                    risk_level=url_analysis["risk_level"],
                    confidence=0.6,
                    threats=url_analysis["threats"],
                    analysis=analysis_details,
                    recommendation=url_analysis["recommendation"],
                    scraped_content=None
                )
                return result
        
        else:
            analysis = await analyze_content("", input_text, None, SCAM_CONFIG)
            
            skip_to_final, skip_reason = should_skip_to_final_output(
                analysis["risk_level"],
                analysis["confidence"],
                analysis["threats"],
                "text"
            )
            analysis_details = dict(analysis.get("details", {}))

            input_payload = {
                "type": "text",
                "text": input_text,
                "timestamp": _current_timestamp(),
            }

            output_payload = {
                "input_type": "text",
                "risk_level": analysis["risk_level"],
                "confidence": analysis["confidence"],
                "threats": analysis["threats"],
                "recommendation": analysis["recommendation"],
                "ai_powered": analysis.get("ai_powered", False),
                "analysis_details": analysis_details,
                "skip_to_final": skip_to_final,
                "skip_reason": skip_reason if skip_to_final else None,
                "timestamp": _current_timestamp(),
            }

            session_id = await persist_session_data(
                input_payload=input_payload,
                output_payload=output_payload,
                input_type="text",
                analysis_mode=analysis_mode,
                raw_text=input_text,
                input_url=None,
                skip_to_final=skip_to_final,
                skip_reason=skip_reason if skip_to_final else None,
            )

            if skip_to_final:
                logger.info("Skipping to Module 5 (final output) - high confidence detected")
            else:
                logger.info("Starting background pipeline (Module 2 → Module 3)")
                start_background_pipeline(session_id)

            result = AnalysisResult(
                session_id=session_id,
                input_type="text",
                risk_level=analysis["risk_level"],
                confidence=analysis["confidence"],
                threats=analysis["threats"],
                analysis=analysis_details,
                recommendation=analysis["recommendation"],
                scraped_content=None,
                ai_powered=analysis.get("ai_powered", False),
                skip_to_final=skip_to_final,
                skip_reason=skip_reason if skip_to_final else None
            )
            return result
    
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/api/status")
async def get_status():
    input_available = await has_any_session()
    output_available = await has_any_module_result()

    return {
        "status": "ready",
        "service": "module1",
        "endpoints": [
            "/api/health",
            "/api/analyze",
            "/api/analyze-image",
            "/api/input",
            "/api/output",
            "/api/status",
        ],
        "features": {
            "text_analysis": True,
            "url_analysis": True,
            "image_analysis": True,
            "gemini_ai": bool(os.getenv("GEMINI_API_KEY")),
            "multimodal": True,
            "data_persistence": True,
        },
        "data_available": {
            "input": input_available,
            "output": output_available,
        },
    }

@app.post("/api/analyze-image", response_model=AnalysisResult)
async def analyze_image(request: AnalyzeImageRequest):
    """
    Analyze image for scam/fraud patterns using Gemini Vision.
    Supports base64 encoded images or image URLs.
    Optimized for serverless deployment (max 4MB).
    """
    try:
        if request.image_type == "url":
            processed = await validate_and_process_image_url(request.image)
            if not processed["success"]:
                raise HTTPException(status_code=400, detail=processed["error"])
            
            image_data = processed["base64_data"]
            mime_type = get_image_mime_type(processed["format"])
            image_info = {
                "format": processed["format"],
                "size_kb": round(processed["size"] / 1024, 2),
                "dimensions": processed["dimensions"],
                "source": "url"
            }
        else:
            validation = validate_base64_image(request.image)
            if not validation["valid"]:
                raise HTTPException(status_code=400, detail=validation["error"])
            
            image_data = request.image
            if ',' in image_data:
                image_data = image_data.split(',', 1)[1]
            
            mime_type = get_image_mime_type(validation["format"])
            image_info = {
                "format": validation["format"],
                "size_kb": round(validation["size"] / 1024, 2),
                "dimensions": validation["dimensions"],
                "source": "upload"
            }
        
        analysis = await gemini_analyze_image(
            image_data,
            mime_type,
            request.context_text,
            request.url
        )
        
        if not analysis:
            raise HTTPException(
                status_code=503,
                detail="AI image analysis unavailable. Please check API configuration."
            )
        
        skip_to_final, skip_reason = should_skip_to_final_output(
            analysis["risk_level"],
            analysis["confidence"],
            analysis["threats"],
            "image"
        )
        analysis_payload = {
            "visual_elements": analysis.get("visual_elements", []),
            "extracted_text": analysis.get("extracted_text", ""),
            "ai_reasoning": analysis.get("reasoning", ""),
        }

        input_payload = {
            "type": "image",
            "image_source": request.image_type,
            "context_text": request.context_text,
            "url": request.url,
            "image_format": image_info["format"],
            "image_size_kb": image_info["size_kb"],
            "timestamp": _current_timestamp(),
        }

        output_payload = {
            "input_type": "image",
            "risk_level": analysis["risk_level"],
            "confidence": analysis["confidence"],
            "threats": analysis["threats"],
            "recommendation": analysis["explanation"],
            "visual_elements": analysis_payload["visual_elements"],
            "extracted_text": analysis_payload["extracted_text"],
            "ai_reasoning": analysis_payload["ai_reasoning"],
            "ai_powered": True,
            "image_info": image_info,
            "skip_to_final": skip_to_final,
            "skip_reason": skip_reason if skip_to_final else None,
            "timestamp": _current_timestamp(),
        }

        session_id = await persist_session_data(
            input_payload=input_payload,
            output_payload=output_payload,
            input_type="image",
            analysis_mode="image",
            raw_text=request.context_text,
            input_url=request.url,
            skip_to_final=skip_to_final,
            skip_reason=skip_reason if skip_to_final else None,
        )

        if skip_to_final:
            logger.info("Skipping to Module 5 (final output) - high confidence fake detected")
        else:
            logger.info("Starting background pipeline (Module 2 → Module 3)")
            start_background_pipeline(session_id)

        return AnalysisResult(
            session_id=session_id,
            input_type="image",
            risk_level=analysis["risk_level"],
            confidence=analysis["confidence"],
            threats=analysis["threats"],
            analysis=analysis_payload,
            recommendation=analysis["explanation"],
            scraped_content=None,
            ai_powered=True,
            image_info=image_info,
            skip_to_final=skip_to_final,
            skip_reason=skip_reason if skip_to_final else None,
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Image analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Image analysis failed: {str(e)}")

@app.get("/api/input")
async def get_input(session_id: str = Query(..., description="Pipeline session identifier")):
    """Get input data saved by Module 1 for a specific session."""
    try:
        session_record = await get_pipeline_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found") from exc

    if not session_record.input_metadata:
        raise HTTPException(status_code=404, detail="Input data not available for this session.")

    return JSONResponse(session_record.input_metadata, status_code=200)


@app.get("/api/output")
async def get_output(session_id: str = Query(..., description="Pipeline session identifier")):
    """Get output data generated by Module 1 for a specific session."""
    try:
        module_result = await get_module_result(session_id, MODULE_NAME)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found") from exc
    except ModuleResultNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Module 1 output not available for this session.") from exc

    return JSONResponse(module_result.payload or {}, status_code=200)

if __name__ == "__main__":
    import uvicorn

    port_env = os.getenv("PORT")
    if port_env:
        port = int(port_env)
        host = "0.0.0.0"
    elif config:
        port = config.get_module1_port()
        host = config.get_module1_host()
    else:
        port = int(os.getenv("MODULE1_PORT", 8001))
        host = os.getenv("HOST", "0.0.0.0")

    logger.info(f"Starting Module1 server on {host}:{port}")

    if sys.platform.startswith("win"):
        os.environ.setdefault("PYTHONASYNCIO_USE_SELECTOR", "1")
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def _serve() -> None:
        config_obj = uvicorn.Config(app, host=host, port=port, log_level="info")
        server = uvicorn.Server(config_obj)
        await server.serve()

    asyncio.run(_serve())
