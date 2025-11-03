"""
Module 4 Backend: Agent Debate & Analysis System
Receives perspective data from Module 3 and conducts AI agent debate
"""
import os
import sys
import json
import uvicorn
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load configuration
try:
    root = Path(__file__).parent.parent.parent
    sys.path.insert(0, str(root))
    from config_loader import get_config
    config = get_config()
    print("[INFO] Configuration loaded successfully")
except Exception as e:
    print(f"[WARNING] Could not load config: {e}. Using defaults.")
    config = None

# Setup logging
try:
    from utils.logger import setup_logger
    logger = setup_logger(__name__)
except ImportError:
    import logging
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('[%(levelname)s] %(name)s: %(message)s'))
    logger.addHandler(handler)

# Import debate orchestrator
try:
    from debate import DebateOrchestrator
    logger.info("Debate orchestrator imported successfully")
except Exception as e:
    logger.warning(f"Could not import debate orchestrator: {e}")
    DebateOrchestrator = None

# Import relevance search system
try:
    from relevance_search import RelevanceSearchSystem
    logger.info("Relevance search system imported successfully")
except Exception as e:
    logger.warning(f"Could not import relevance search system: {e}")
    RelevanceSearchSystem = None

app = FastAPI(
    title="Module 4: Agent Debate & Analysis API",
    version="1.0.0",
    description="AI agent debate system for information trust analysis"
)

# Build CORS origins from config
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
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001"
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data models
class PerspectiveData(BaseModel):
    leftist: List[Dict[str, Any]]
    rightist: List[Dict[str, Any]]
    common: List[Dict[str, Any]]
    input: Optional[Dict[str, Any]] = None

# Global state
latest_debate_result = None

@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "service": "Module 4: Agent Debate & Analysis",
        "version": "1.0.0",
        "endpoints": {
            "health": "/api/health",
            "upload_perspectives": "/upload-perspectives",
            "debate": "/api/debate",
            "debate_result": "/api/debate/result",
            "status": "/api/status"
        }
    }

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "debate_available": DebateOrchestrator is not None
    }

@app.post("/upload-perspectives")
async def upload_perspectives(data: PerspectiveData):
    """
    Receive perspective data from Module 3 and save to data directory.
    
    Args:
        data: PerspectiveData containing lists of perspectives for each category and input data
        
    Returns:
        Success status with counts of perspectives received
    """
    try:
        base_dir = Path(__file__).parent
        data_dir = base_dir / "data"
        data_dir.mkdir(exist_ok=True)
        
        logger.info("Receiving perspective data from Module 3...")
        
        # Save leftist perspectives
        leftist_file = data_dir / "leftist.json"
        with open(leftist_file, "w", encoding="utf-8") as f:
            json.dump(data.leftist, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved {len(data.leftist)} leftist perspectives")
        
        # Save rightist perspectives
        rightist_file = data_dir / "rightist.json"
        with open(rightist_file, "w", encoding="utf-8") as f:
            json.dump(data.rightist, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved {len(data.rightist)} rightist perspectives")
        
        # Save common perspectives
        common_file = data_dir / "common.json"
        with open(common_file, "w", encoding="utf-8") as f:
            json.dump(data.common, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved {len(data.common)} common perspectives")
        
        # Save input data if provided
        input_saved = False
        if data.input:
            input_file = data_dir / "input.json"
            with open(input_file, "w", encoding="utf-8") as f:
                json.dump(data.input, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved input data: {data.input.get('topic', 'Unknown topic')}")
            input_saved = True
        
        total = len(data.leftist) + len(data.rightist) + len(data.common)
        logger.info(f"Total {total} perspectives saved to data directory")
        
        return {
            "status": "success",
            "message": "Perspective data uploaded successfully",
            "counts": {
                "leftist": len(data.leftist),
                "rightist": len(data.rightist),
                "common": len(data.common),
                "total": total
            },
            "files_created": [
                str(leftist_file.relative_to(base_dir)),
                str(rightist_file.relative_to(base_dir)),
                str(common_file.relative_to(base_dir))
            ] + ([str((data_dir / "input.json").relative_to(base_dir))] if input_saved else []),
            "input_received": input_saved
        }
    except Exception as e:
        logger.error(f"Failed to save perspective data: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save perspective data: {str(e)}"
        )

@app.post("/api/enrich-perspectives")
async def enrich_perspectives():
    """
    Enrich perspective data with web-scraped content.
    Converts leftist.json, rightist.json, common.json into relevant_*.json files
    with relevant links, trust scores, and extracted web content.
    """
    try:
        base_dir = Path(__file__).parent
        data_dir = base_dir / "data"
        
        # Check if required files exist
        required_files = ["leftist.json", "rightist.json", "common.json"]
        missing_files = [f for f in required_files if not (data_dir / f).exists()]
        
        if missing_files:
            raise HTTPException(
                status_code=404,
                detail=f"Required files not found: {', '.join(missing_files)}. Please upload perspective data first."
            )
        
        if not RelevanceSearchSystem:
            raise HTTPException(
                status_code=503,
                detail="Relevance search system not available. Please ensure all required modules are installed (google-api-python-client, selenium)."
            )
        
        logger.info("Starting perspective enrichment with web scraping...")
        
        # Initialize relevance search system
        system = RelevanceSearchSystem(data_dir=str(data_dir))
        
        try:
            # Process all files and enrich with web content
            results = system.process_all_files()
            
            # Count total enriched perspectives
            total_enriched = sum(
                sum(len(item['relevant_links']) for item in file_data['items'])
                for file_data in results.values()
            )
            
            logger.info(f"Enrichment completed: {total_enriched} relevant links found")
            
            return {
                "status": "completed",
                "message": "Perspectives enriched successfully with web content",
                "files_created": [
                    f"relevant_{f}" for f in required_files
                ],
                "total_relevant_links": total_enriched,
                "summary": {
                    filename: {
                        "total_items": data['total_items'],
                        "items_with_links": sum(1 for item in data['items'] if item['relevant_links'])
                    }
                    for filename, data in results.items()
                }
            }
        finally:
            system.cleanup()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Enrichment failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Enrichment failed: {str(e)}")

@app.post("/api/debate")
async def start_debate(use_enriched: bool = True):
    """
    Start the AI agent debate
    
    Args:
        use_enriched: If True, uses relevant_*.json files with web-scraped content.
                     If False or files not found, falls back to simple perspective files.
    """
    global latest_debate_result
    
    try:
        base_dir = Path(__file__).parent
        data_dir = base_dir / "data"
        
        # Determine which files to use
        if use_enriched:
            required_files = ["relevant_leftist.json", "relevant_rightist.json", "relevant_common.json"]
            missing_enriched = [f for f in required_files if not (data_dir / f).exists()]
            
            if missing_enriched:
                logger.info("Enriched files not found, falling back to simple perspective files")
                required_files = ["leftist.json", "rightist.json", "common.json"]
        else:
            required_files = ["leftist.json", "rightist.json", "common.json"]
        
        missing_files = [f for f in required_files if not (data_dir / f).exists()]
        
        if missing_files:
            raise HTTPException(
                status_code=404,
                detail=f"Required files not found: {', '.join(missing_files)}. Please upload perspective data first using /upload-perspectives endpoint."
            )
        
        if not DebateOrchestrator:
            raise HTTPException(
                status_code=503,
                detail="Debate orchestrator not available. Please ensure all required modules are installed."
            )
        
        using_enriched = all((data_dir / f).exists() for f in ["relevant_leftist.json", "relevant_rightist.json", "relevant_common.json"])
        logger.info(f"Starting debate with {'enriched' if using_enriched else 'simple'} perspective data...")
        
        # Initialize debate orchestrator with data directory
        orchestrator = DebateOrchestrator()
        
        # Load perspective data
        perspectives = {}
        for filename in required_files:
            file_path = data_dir / filename
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
                # Handle enriched format (has 'items' key) vs simple format (direct array)
                if isinstance(data, dict) and 'items' in data:
                    perspectives_list = data['items']
                else:
                    perspectives_list = data
                
                # Extract category name
                category = filename.replace('relevant_', '').replace('.json', '')
                perspectives[category] = perspectives_list
        
        # Conduct debate
        result = orchestrator.conduct_debate(
            leftist_perspectives=perspectives.get('leftist', []),
            rightist_perspectives=perspectives.get('rightist', []),
            common_perspectives=perspectives.get('common', []),
            max_rounds=3,
            min_rounds=1
        )
        
        # Store result in memory
        latest_debate_result = result
        
        # Save to file
        result_file = base_dir / "debate_result.json"
        with open(result_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        
        logger.info("Debate completed successfully")
        
        return {
            "status": "completed",
            "message": "Debate completed successfully",
            "trust_score": result.get("trust_score", 50),
            "judgment": result.get("judgment", ""),
            "debate_transcript": result.get("debate_transcript", []),
            "topic": result.get("topic", ""),
            "debate_file": "debate_result.json"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Debate failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Debate failed: {str(e)}")

@app.get("/api/debate/result")
async def get_debate_result():
    """Get the latest debate result"""
    global latest_debate_result
    
    try:
        # First try to return from memory
        if latest_debate_result:
            return latest_debate_result
        
        # Then try to load from file
        base_dir = Path(__file__).parent
        result_file = base_dir / "debate_result.json"
        
        if result_file.exists():
            with open(result_file, "r", encoding="utf-8") as f:
                result = json.load(f)
                latest_debate_result = result
            return result
        
        raise HTTPException(
            status_code=404,
            detail="No debate result available. Please run /api/debate endpoint first."
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to load debate result: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load debate result: {str(e)}")

@app.post("/api/clear")
async def clear_all_data():
    """Clear all perspective and debate data - for new session"""
    try:
        base_dir = Path(__file__).parent
        data_dir = base_dir / "data"
        
        files_to_remove = [
            "leftist.json",
            "rightist.json", 
            "common.json",
            "input.json",
            "relevant_leftist.json",
            "relevant_rightist.json",
            "relevant_common.json"
        ]
        
        removed_files = []
        for filename in files_to_remove:
            file_path = data_dir / filename
            if file_path.exists():
                file_path.unlink()
                removed_files.append(filename)
        
        # Also clear debate result
        debate_result_file = base_dir / "debate_result.json"
        if debate_result_file.exists():
            debate_result_file.unlink()
            removed_files.append("debate_result.json")
        
        global latest_debate_result
        latest_debate_result = None
        
        logger.info(f"Cleared {len(removed_files)} files for new session")
        
        return {
            "status": "success",
            "message": "All Module 4 data cleared",
            "files_removed": removed_files
        }
    except Exception as e:
        logger.error(f"Failed to clear data: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to clear data: {str(e)}")

@app.get("/api/status")
async def get_status():
    """Get current system status"""
    base_dir = Path(__file__).parent
    data_dir = base_dir / "data"
    
    files_exist = {
        "leftist": (data_dir / "leftist.json").exists(),
        "rightist": (data_dir / "rightist.json").exists(),
        "common": (data_dir / "common.json").exists(),
        "input": (data_dir / "input.json").exists()
    }
    
    enriched_files_exist = {
        "relevant_leftist": (data_dir / "relevant_leftist.json").exists(),
        "relevant_rightist": (data_dir / "relevant_rightist.json").exists(),
        "relevant_common": (data_dir / "relevant_common.json").exists()
    }
    
    return {
        "status": "ready" if DebateOrchestrator else "limited",
        "timestamp": datetime.now().isoformat(),
        "debate_available": DebateOrchestrator is not None,
        "perspective_files": files_exist,
        "enriched_files_exist": all(enriched_files_exist.values()),
        "enriched_files": enriched_files_exist,
        "ready_for_debate": all([files_exist["leftist"], files_exist["rightist"], files_exist["common"]])
    }

@app.get("/api/enrichment-result")
async def get_enrichment_result():
    """Get enrichment results if available"""
    base_dir = Path(__file__).parent
    data_dir = base_dir / "data"
    
    enriched_files = ["relevant_leftist.json", "relevant_rightist.json", "relevant_common.json"]
    missing = [f for f in enriched_files if not (data_dir / f).exists()]
    
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Enriched files not found: {', '.join(missing)}"
        )
    
    try:
        total_links = 0
        summary = {}
        
        for filename in enriched_files:
            file_path = data_dir / filename
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
                if isinstance(data, dict) and 'items' in data:
                    items = data['items']
                    items_with_links = sum(1 for item in items if item.get('relevant_links'))
                    link_count = sum(len(item.get('relevant_links', [])) for item in items)
                    total_links += link_count
                    
                    category = filename.replace('relevant_', '').replace('.json', '')
                    summary[filename] = {
                        "total_items": len(items),
                        "items_with_links": items_with_links
                    }
        
        return {
            "status": "completed",
            "message": "Enrichment data available",
            "total_relevant_links": total_links,
            "summary": summary
        }
    except Exception as e:
        logger.error(f"Failed to read enrichment results: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read enrichment results: {str(e)}")

if __name__ == "__main__":
    # Get port from config or environment
    if config:
        host = config.get_module4_host()
        port = config.get_module4_port()
    else:
        host = "127.0.0.1"
        port = int(os.getenv("MODULE4_PORT", 8004))
    
    logger.info(f"Starting Module 4 server on {host}:{port}")
    logger.info("Waiting for perspective data from Module 3...")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )
