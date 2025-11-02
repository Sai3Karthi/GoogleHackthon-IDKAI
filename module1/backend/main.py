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

from scraper import scrape_url, detect_input_type
from analyzer import analyze_content, quick_url_check
from validators import validate_url_safety

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

class AnalyzeRequest(BaseModel):
    input: str
    deep_scan: Optional[bool] = False
    
    @validator('input')
    def input_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Input cannot be empty')
        return v.strip()

class AnalysisResult(BaseModel):
    input_type: str
    risk_level: str
    confidence: float
    threats: List[str]
    analysis: Dict[str, Any]
    recommendation: str
    scraped_content: Optional[Dict[str, str]] = None

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Module1 Link Verification",
        "version": "1.0.0"
    }

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
                
                return AnalysisResult(
                    input_type="url",
                    risk_level=analysis["risk_level"],
                    confidence=analysis["confidence"],
                    threats=analysis["threats"],
                    analysis=analysis["details"],
                    recommendation=analysis["recommendation"],
                    scraped_content={
                        "title": scraped["title"],
                        "text": scraped["text"][:500] + "..." if len(scraped["text"]) > 500 else scraped["text"]
                    }
                )
            else:
                url_analysis = await validate_url_safety(input_text, SCAM_CONFIG)
                return AnalysisResult(
                    input_type="url",
                    risk_level=url_analysis["risk_level"],
                    confidence=0.6,
                    threats=url_analysis["threats"],
                    analysis=url_analysis,
                    recommendation=url_analysis["recommendation"],
                    scraped_content=None
                )
        
        else:
            analysis = await analyze_content("", input_text, None, SCAM_CONFIG)
            
            return AnalysisResult(
                input_type="text",
                risk_level=analysis["risk_level"],
                confidence=analysis["confidence"],
                threats=analysis["threats"],
                analysis=analysis["details"],
                recommendation=analysis["recommendation"],
                scraped_content=None
            )
    
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/api/status")
async def get_status():
    return {
        "status": "ready",
        "service": "module1",
        "endpoints": ["/api/health", "/api/analyze", "/api/status"]
    }

@app.get("/api/input")
async def get_input():
    return JSONResponse(
        {"message": "Module1 does not use input files. Use POST /api/analyze with your URL or text."},
        status_code=200
    )

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
