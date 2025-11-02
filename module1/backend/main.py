"""
Module1 FastAPI server for link verification and scam detection.

Provides REST API endpoints for analyzing URLs and text content
for potential scams, phishing, and malicious content.
"""
from contextlib import asynccontextmanager
from pathlib import Path
import sys
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from typing import Optional, List, Dict, Any
import json
import httpx

from scraper import scrape_url, detect_input_type
from analyzer import analyze_content, quick_url_check, gemini_analyze_image
from validators import validate_url_safety
from image_utils import (
    validate_and_process_image_url,
    process_image_bytes,
    validate_base64_image,
    get_image_mime_type
)

CONFIG_PATH = Path(__file__).parent / "config.json"
with open(CONFIG_PATH, "r") as f:
    SCAM_CONFIG = json.load(f)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Module1 server starting up...")
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
async def trigger_pipeline_background():
    """Trigger Module 2 and Module 3 in background without blocking Module 1 response"""
    try:
        import asyncio
        # Small delay to ensure files are written
        await asyncio.sleep(0.5)
        
        # Trigger Module 2
        module2_port = os.getenv("MODULE2_PORT", "8002")
        url = f"http://127.0.0.1:{module2_port}/api/process"
        logger.info(f"[Background] Triggering Module 2 at {url}")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, timeout=60.0)
                
                if response.status_code == 200:
                    logger.info("[Background] Module 2 processing completed successfully")
                    
                    # Wait a bit for Module 2 to save files
                    await asyncio.sleep(1)
                    
                    # Trigger Module 3
                    module3_port = os.getenv("MODULE3_PORT", "8003")
                    module3_url = f"http://127.0.0.1:{module3_port}/api/run_pipeline_stream"
                    logger.info(f"[Background] Triggering Module 3 at {module3_url}")
                    
                    response3 = await client.post(module3_url, timeout=120.0)
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

def start_background_pipeline():
    """Start the pipeline in background (fire and forget)"""
    import asyncio
    try:
        # Create task without awaiting it
        asyncio.create_task(trigger_pipeline_background())
        logger.info("Background pipeline task created")
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

def save_input_output(input_data: dict, output_data: dict):
    """Save input and output to JSON files for other modules to access."""
    try:
        input_path = Path(__file__).parent / "input.json"
        output_path = Path(__file__).parent / "output.json"
        
        with open(input_path, "w", encoding="utf-8") as f:
            json.dump(input_data, f, indent=2, ensure_ascii=False)
        
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        
        logger.info("Saved input and output to JSON files")
    except Exception as e:
        logger.error(f"Failed to save JSON files: {e}")

@app.post("/api/analyze", response_model=AnalysisResult)
async def analyze_input(request: AnalyzeRequest):
    try:
        input_text = request.input
        input_type = detect_input_type(input_text)
        
        if input_type == "url":
            quick_check = await quick_url_check(input_text)
            if quick_check["is_malicious"]:
                return AnalysisResult(
                    input_type="url",
                    risk_level="dangerous",
                    confidence=0.95,
                    threats=quick_check["threats"],
                    analysis=quick_check,
                    recommendation="DO NOT VISIT THIS SITE. Known malicious URL detected.",
                    scraped_content=None
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
                
                result = AnalysisResult(
                    input_type="url",
                    risk_level=analysis["risk_level"],
                    confidence=analysis["confidence"],
                    threats=analysis["threats"],
                    analysis=analysis.get("details", {}),
                    recommendation=analysis["recommendation"],
                    scraped_content={
                        "title": scraped["title"],
                        "text": scraped["text"][:500] + "..." if len(scraped["text"]) > 500 else scraped["text"]
                    },
                    ai_powered=analysis.get("ai_powered", False),
                    skip_to_final=skip_to_final,
                    skip_reason=skip_reason if skip_to_final else None
                )
                
                save_input_output(
                    input_data={
                        "type": "url",
                        "url": input_text,
                        "timestamp": __import__("datetime").datetime.now().isoformat()
                    },
                    output_data={
                        "input_type": result.input_type,
                        "risk_level": result.risk_level,
                        "confidence": result.confidence,
                        "threats": result.threats,
                        "recommendation": result.recommendation,
                        "scraped_title": scraped["title"],
                        "scraped_text": scraped["text"],
                        "ai_powered": result.ai_powered,
                        "analysis_details": analysis.get("details", {}),
                        "skip_to_final": skip_to_final,
                        "skip_reason": skip_reason if skip_to_final else None,
                        "timestamp": __import__("datetime").datetime.now().isoformat()
                    }
                )
                
                # Trigger next module based on skip logic
                if skip_to_final:
                    logger.info("Skipping to Module 5 (final output) - high confidence detected")
                else:
                    logger.info("Starting background pipeline (Module 2 → Module 3)")
                    start_background_pipeline()
                
                return result
            else:
                url_analysis = await validate_url_safety(input_text, SCAM_CONFIG)
                result = AnalysisResult(
                    input_type="url",
                    risk_level=url_analysis["risk_level"],
                    confidence=0.6,
                    threats=url_analysis["threats"],
                    analysis=url_analysis,
                    recommendation=url_analysis["recommendation"],
                    scraped_content=None
                )
                
                save_input_output(
                    input_data={
                        "type": "url",
                        "url": input_text,
                        "timestamp": __import__("datetime").datetime.now().isoformat()
                    },
                    output_data={
                        "input_type": result.input_type,
                        "risk_level": result.risk_level,
                        "confidence": result.confidence,
                        "threats": result.threats,
                        "recommendation": result.recommendation,
                        "scraping_failed": True,
                        "timestamp": __import__("datetime").datetime.now().isoformat()
                    }
                )
                
                # Trigger Module 2/3 even for failed scrapes
                logger.info("Starting background pipeline (Module 2 → Module 3)")
                start_background_pipeline()
                
                return result
        
        else:
            analysis = await analyze_content("", input_text, None, SCAM_CONFIG)
            
            skip_to_final, skip_reason = should_skip_to_final_output(
                analysis["risk_level"],
                analysis["confidence"],
                analysis["threats"],
                "text"
            )
            
            result = AnalysisResult(
                input_type="text",
                risk_level=analysis["risk_level"],
                confidence=analysis["confidence"],
                threats=analysis["threats"],
                analysis=analysis.get("details", {}),
                recommendation=analysis["recommendation"],
                scraped_content=None,
                ai_powered=analysis.get("ai_powered", False),
                skip_to_final=skip_to_final,
                skip_reason=skip_reason if skip_to_final else None
            )
            
            save_input_output(
                input_data={
                    "type": "text",
                    "text": input_text,
                    "timestamp": __import__("datetime").datetime.now().isoformat()
                },
                output_data={
                    "input_type": result.input_type,
                    "risk_level": result.risk_level,
                    "confidence": result.confidence,
                    "threats": result.threats,
                    "recommendation": result.recommendation,
                    "ai_powered": result.ai_powered,
                    "analysis_details": analysis.get("details", {}),
                    "skip_to_final": skip_to_final,
                    "skip_reason": skip_reason if skip_to_final else None,
                    "timestamp": __import__("datetime").datetime.now().isoformat()
                }
            )
            
            # Trigger next module based on skip logic
            if skip_to_final:
                logger.info("Skipping to Module 5 (final output) - high confidence detected")
            else:
                logger.info("Starting background pipeline (Module 2 → Module 3)")
                start_background_pipeline()
            
            return result
    
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/api/status")
async def get_status():
    input_path = Path(__file__).parent / "input.json"
    output_path = Path(__file__).parent / "output.json"
    
    return {
        "status": "ready",
        "service": "module1",
        "endpoints": ["/api/health", "/api/analyze", "/api/analyze-image", "/api/input", "/api/output", "/api/status"],
        "features": {
            "text_analysis": True,
            "url_analysis": True,
            "image_analysis": True,
            "gemini_ai": bool(os.getenv("GEMINI_API_KEY")),
            "multimodal": True,
            "data_persistence": True
        },
        "data_available": {
            "input": input_path.exists(),
            "output": output_path.exists()
        }
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
        
        result = AnalysisResult(
            input_type="image",
            risk_level=analysis["risk_level"],
            confidence=analysis["confidence"],
            threats=analysis["threats"],
            analysis={
                "visual_elements": analysis.get("visual_elements", []),
                "extracted_text": analysis.get("extracted_text", ""),
                "ai_reasoning": analysis.get("reasoning", "")
            },
            recommendation=analysis["explanation"],
            scraped_content=None,
            ai_powered=True,
            image_info=image_info,
            skip_to_final=skip_to_final,
            skip_reason=skip_reason if skip_to_final else None
        )
        
        save_input_output(
            input_data={
                "type": "image",
                "image_source": request.image_type,
                "context_text": request.context_text,
                "url": request.url,
                "image_format": image_info["format"],
                "image_size_kb": image_info["size_kb"],
                "timestamp": __import__("datetime").datetime.now().isoformat()
            },
            output_data={
                "input_type": result.input_type,
                "risk_level": result.risk_level,
                "confidence": result.confidence,
                "threats": result.threats,
                "recommendation": result.recommendation,
                "visual_elements": analysis.get("visual_elements", []),
                "extracted_text": analysis.get("extracted_text", ""),
                "ai_reasoning": analysis.get("reasoning", ""),
                "ai_powered": True,
                "image_info": image_info,
                "skip_to_final": skip_to_final,
                "skip_reason": skip_reason if skip_to_final else None,
                "timestamp": __import__("datetime").datetime.now().isoformat()
            }
        )
        
        # Trigger next module based on skip logic
        if skip_to_final:
            logger.info("Skipping to Module 5 (final output) - high confidence fake detected")
        else:
            logger.info("Starting background pipeline (Module 2 → Module 3)")
            start_background_pipeline()
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Image analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Image analysis failed: {str(e)}")

@app.get("/api/input")
async def get_input():
    """Get the last input data saved by Module 1."""
    try:
        input_path = Path(__file__).parent / "input.json"
        if not input_path.exists():
            return JSONResponse(
                {"message": "No input data available yet. Analyze something first."},
                status_code=404
            )
        
        with open(input_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        return JSONResponse(data, status_code=200)
    except Exception as e:
        logger.error(f"Error reading input.json: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read input data: {str(e)}")

@app.get("/api/output")
async def get_output():
    """Get the last output data generated by Module 1."""
    try:
        output_path = Path(__file__).parent / "output.json"
        if not output_path.exists():
            return JSONResponse(
                {"message": "No output data available yet. Analyze something first."},
                status_code=404
            )
        
        with open(output_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        return JSONResponse(data, status_code=200)
    except Exception as e:
        logger.error(f"Error reading output.json: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read output data: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    
    if config:
        host = config.get_module1_host()
        port = config.get_module1_port()
    else:
        host = "127.0.0.1"
        port = int(os.getenv("MODULE1_PORT", 8001))
    
    logger.info(f"Starting Module1 server on {host}:{port}")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )
