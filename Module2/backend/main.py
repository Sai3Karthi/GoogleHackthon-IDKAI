#!/usr/bin/env python3
import json
import re
import sys
import os
from pathlib import Path
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv
from Modules.Classifier.classifier import FakeNewsDetector
from Modules.SignificanceScore.scoreProvider import get_triage_score
from Modules.Summarizer.summarizer import ComprehensiveSummarizer

# Load environment variables from root .env file
root_dir = Path(__file__).resolve().parents[2]
env_path = root_dir / ".env"
load_dotenv(dotenv_path=env_path)

# Get configuration from environment variables
API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("MODULE2_PORT", 8002))
APP_TITLE = os.getenv("APP_TITLE", "Module 2: Information Classification")
APP_DESCRIPTION = os.getenv("APP_DESCRIPTION", "Classify information and assign significance scores based on Module 1 analysis")
APP_VERSION = os.getenv("APP_VERSION", "1.0.0")

# Validate required environment variables
if not API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable is required in root .env")

# File paths
MODULE1_INPUT_PATH = root_dir / "module1" / "backend" / "input.json"
MODULE1_OUTPUT_PATH = root_dir / "module1" / "backend" / "output.json"
MODULE2_OUTPUT_PATH = Path(__file__).parent / "output.json"
MODULE3_INPUT_PATH = root_dir / "module3" / "backend" / "input.json"

# FastAPI app instance
app = FastAPI(
    title=APP_TITLE,
    description=APP_DESCRIPTION,
    version=APP_VERSION
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components globally with environment variables
classifier = FakeNewsDetector(API_KEY, MODEL_NAME)
summarizer = ComprehensiveSummarizer(API_KEY, MODEL_NAME)

print(f"Module 2 initialized with API key: {API_KEY[:20]}...")
print(f"Using model: {MODEL_NAME}")
print(f"Port: {PORT}")


# Pydantic models for request/response
class Module1Output(BaseModel):
    input_type: str
    risk_level: str
    confidence: float
    threats: List[str]
    recommendation: str
    ai_powered: bool
    analysis_details: Optional[Dict[str, Any]] = None
    skip_to_final: Optional[bool] = False
    skip_reason: Optional[str] = None
    timestamp: str

class ClassificationResult(BaseModel):
    person: float
    organization: float
    social: float
    critical: float
    stem: float

class DetailedAnalysis(BaseModel):
    classification: ClassificationResult
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


# API Endpoints

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": APP_TITLE,
        "version": APP_VERSION,
        "endpoints": {
            "POST /api/process": "Process Module 1 output and generate classification",
            "GET /api/input": "Get Module 1 input data",
            "GET /api/output": "Get Module 2 output data",
            "GET /api/health": "Health check endpoint"
        }
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "message": "Module 2 Classification Service",
        "model": MODEL_NAME,
        "port": PORT
    }


@app.get("/api/input")
async def get_module1_output():
    """
    Get Module 1's output data (which becomes Module 2's input)
    """
    try:
        if not MODULE1_OUTPUT_PATH.exists():
            raise HTTPException(status_code=404, detail="Module 1 output not found. Please run Module 1 first.")
        
        with open(MODULE1_OUTPUT_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return data
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON in Module 1 output: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read Module 1 output: {str(e)}")


@app.get("/api/output")
async def get_module2_output():
    """
    Get Module 2's output data
    """
    try:
        if not MODULE2_OUTPUT_PATH.exists():
            raise HTTPException(status_code=404, detail="Module 2 output not found. Please run /api/process first.")
        
        with open(MODULE2_OUTPUT_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return data
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON in Module 2 output: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read Module 2 output: {str(e)}")


@app.post("/api/process")
async def process_module1_output():
    """
    Process Module 1's output:
    1. Clear old Module 2 output
    2. Read Module 1 output and input
    3. Classify the information
    4. Calculate significance score (inverse of confidence)
    5. Generate comprehensive summary
    6. Save detailed output to output.json
    7. Save simplified data to Module 3's input.json
    
    Returns:
        Module2Output with detailed analysis
        
    Raises:
        HTTPException: If processing fails
    """
    try:
        # Clear old output files first
        if MODULE2_OUTPUT_PATH.exists():
            print(f"Clearing old Module 2 output: {MODULE2_OUTPUT_PATH}")
            MODULE2_OUTPUT_PATH.unlink()
        
        if MODULE3_INPUT_PATH.exists():
            print(f"Clearing old Module 3 input: {MODULE3_INPUT_PATH}")
            MODULE3_INPUT_PATH.unlink()
        
        # Read Module 1 output
        if not MODULE1_OUTPUT_PATH.exists():
            raise HTTPException(status_code=404, detail="Module 1 output not found. Please run Module 1 analysis first.")
        
        with open(MODULE1_OUTPUT_PATH, 'r', encoding='utf-8') as f:
            module1_output = json.load(f)
        
        # Read Module 1 input to get original text
        if not MODULE1_INPUT_PATH.exists():
            raise HTTPException(status_code=404, detail="Module 1 input not found.")
        
        with open(MODULE1_INPUT_PATH, 'r', encoding='utf-8') as f:
            module1_input = json.load(f)
        
        # Try multiple keys for text content
        original_text = (
            module1_input.get('text') or 
            module1_input.get('url') or 
            module1_input.get('content') or
            module1_input.get('scraped_text') or
            ''
        )
        
        if not original_text or not original_text.strip():
            # Try to get text from module1_output if available
            original_text = (
                module1_output.get('scraped_text') or
                module1_output.get('extracted_text') or
                module1_output.get('ai_reasoning') or
                ''
            )
        
        if not original_text or not original_text.strip():
            raise HTTPException(
                status_code=400, 
                detail="No text content found in Module 1 input or output. Please provide valid text content for analysis."
            )
        
        # Extract Module 1 data
        confidence = module1_output.get('confidence', 0.5)
        risk_level = module1_output.get('risk_level', 'unknown')
        threats = module1_output.get('threats', [])
        
        print(f"[Module2] Processing text ({len(original_text)} chars)")
        print(f"[Module2] Module 1 confidence: {confidence}, risk: {risk_level}, threats: {len(threats)}")
        
        # Classify the information using AI
        print(f"[Module2] Classifying: {original_text[:100]}...")
        try:
            classification_result = classifier.classify(original_text)
        except Exception as e:
            error_msg = str(e)
            if "403" in error_msg or "Permission" in error_msg or "leaked" in error_msg:
                raise HTTPException(
                    status_code=403,
                    detail="API Key Error: Your Google API key was reported as leaked and has been disabled. "
                           "Please get a new API key from https://aistudio.google.com/apikey and update the "
                           "GEMINI_API_KEY in your .env file. See API_KEY_SETUP.md for detailed instructions."
                )
            raise HTTPException(status_code=500, detail=f"Classification failed: {error_msg}")
        
        if not classification_result:
            raise HTTPException(status_code=500, detail="Classification failed")
        
        # Calculate significance score (inverse of confidence)
        significance_score, significance_explanation = calculate_significance_score(
            confidence, risk_level, threats
        )
        
        # Generate comprehensive summary
        print("[Module2] Generating summary...")
        try:
            summary_result = summarizer.summarize(original_text)
        except Exception as e:
            error_msg = str(e)
            if "403" in error_msg or "Permission" in error_msg or "leaked" in error_msg:
                raise HTTPException(
                    status_code=403,
                    detail="API Key Error: Your Google API key was reported as leaked and has been disabled. "
                           "Please get a new API key from https://aistudio.google.com/apikey and update the "
                           "GEMINI_API_KEY in your .env file. See API_KEY_SETUP.md for detailed instructions."
                )
            raise HTTPException(status_code=500, detail=f"Summarization failed: {error_msg}")
        
        if not summary_result:
            raise HTTPException(status_code=500, detail="Summarization failed")
        
        # Determine if debate is required (significance > 50)
        requires_debate = significance_score >= 50
        
        if significance_score >= 80:
            debate_priority = "critical"
        elif significance_score >= 60:
            debate_priority = "high"
        elif significance_score >= 30:
            debate_priority = "medium"
        else:
            debate_priority = "low"
        
        # Create detailed analysis
        detailed_analysis = DetailedAnalysis(
            classification=ClassificationResult(
                person=classification_result.person,
                organization=classification_result.organization,
                social=classification_result.social,
                critical=classification_result.critical,
                stem=classification_result.stem
            ),
            classification_reasoning=classification_result.reasoning,
            classification_confidence=classification_result.confidence_score,
            significance_score=significance_score,
            significance_explanation=significance_explanation,
            comprehensive_summary=summary_result.comprehensive_summary,
            requires_debate=requires_debate,
            debate_priority=debate_priority
        )
        
        # Create Module 2 output
        module2_output = Module2Output(
            detailed_analysis=detailed_analysis,
            module1_confidence=confidence,
            module1_risk_level=risk_level,
            module1_threats=threats,
            timestamp=datetime.now().isoformat()
        )
        
        # Save Module 2 output (detailed)
        MODULE2_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(MODULE2_OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(module2_output.dict(), f, indent=2, ensure_ascii=False)
        
        # Save Module 3 input (simplified - matching Module 3's expected format)
        # Use comprehensive summary as topic, original text as text, significance_score as float (0-1 normalized)
        module3_input = Module3Input(
            topic=summary_result.comprehensive_summary[:200] + "..." if len(summary_result.comprehensive_summary) > 200 else summary_result.comprehensive_summary,
            text=original_text,
            significance_score=significance_score / 100.0  # Normalize to 0-1 range
        )
        
        MODULE3_INPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(MODULE3_INPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(module3_input.dict(), f, indent=2, ensure_ascii=False)
        
        print(f"[Module2] Processing complete. Significance score: {significance_score}/100 ({significance_score/100.0:.2f})")
        print(f"[Module2] Debate required: {requires_debate} (Priority: {debate_priority})")
        print(f"[Module2] Module 3 input saved to: {MODULE3_INPUT_PATH}")
        print(f"[Module2] Module 2 output saved to: {MODULE2_OUTPUT_PATH}")
        
        return module2_output
        
    except HTTPException as he:
        print(f"[Module2 ERROR] HTTP {he.status_code}: {he.detail}")
        raise
    except Exception as e:
        import traceback
        print(f"[Module2 ERROR] Unexpected error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
