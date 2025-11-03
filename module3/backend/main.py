"""
Module3 FastAPI server for perspective generation pipeline.

Provides REST API and WebSocket endpoints for running the perspective
generation pipeline and streaming results to clients.
"""

import os
import sys
import subprocess
import threading
import time
import json
import asyncio
import argparse
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable, Dict, List, Any, Optional

import requests
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

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

# Load environment variables from root .env file
try:
    root = Path(__file__).parent.parent.parent
    sys.path.insert(0, str(root))
    from utils.env_loader import load_env_file
    
    env_path = root / '.env'
    if load_env_file(env_path):
        logger.info(f"Environment variables loaded from {env_path}")
    else:
        logger.warning(f"No .env file found at {env_path}")
except (ImportError, ValueError):
    # Fallback to dotenv if utils not available
    try:
        from dotenv import load_dotenv
        env_path = Path(__file__).parent.parent.parent / '.env'
        load_dotenv(env_path)
        logger.info(f"Environment variables loaded from {env_path}")
    except ImportError:
        logger.info("python-dotenv not available, using system environment variables")

# Add main_modules to path to import api_request
sys.path.append(os.path.join(os.path.dirname(__file__), 'main_modules'))
from main_modules import api_request

# Load configuration
try:
    from config_loader import get_config
    config = get_config()
    logger.info("Configuration loaded successfully")
except Exception as e:
    logger.warning(f"Could not load config: {e}. Using defaults.")
    config = None

# Event to signal server shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI application.
    
    Runs the full module3 pipeline on startup:
    1. Generates perspectives (output.json)
    2. Runs clustering to create final_output JSON files
    
    Also starts a background thread to monitor shutdown signals.
    """
    def run_full_pipeline():
        """Run the complete module3 pipeline."""
        try:
            args = argparse.Namespace(
                input="input.json",
                output="output.json",
                endpoint=None,
                model=None,
                temperature=0.6
            )
            
            # Step 1: Run perspective generation pipeline
            logger.info("Starting perspective generation pipeline")
            pipeline_code = api_request.run_pipeline(args)
            if pipeline_code != 0:
                logger.error(f"Pipeline failed with exit code {pipeline_code}")
                return False
            logger.info("Pipeline completed successfully - output.json generated")
            
            # Step 2: Run clustering to generate final_output JSON files
            logger.info("Starting clustering process to generate final_output files")
            if not run_clustering():
                logger.error("Clustering failed")
                return False
            logger.info("Clustering completed successfully - final_output files generated")
            
            # Verify all three files exist
            base_dir = Path(__file__).parent
            final_output_dir = base_dir / "final_output"
            required_files = ["leftist.json", "rightist.json", "common.json"]
            all_files_exist = all((final_output_dir / f).exists() for f in required_files)
            
            if all_files_exist:
                logger.info("All three perspective files generated successfully:")
                for f in required_files:
                    file_path = final_output_dir / f
                    logger.info(f"  ✓ {file_path}")
            else:
                logger.warning("Some required files are missing:")
                for f in required_files:
                    file_path = final_output_dir / f
                    if not file_path.exists():
                        logger.warning(f"  ✗ {file_path} - MISSING")
                    else:
                        logger.info(f"  ✓ {file_path}")
            
            return True
        except Exception as e:
            logger.error(f"Error running full pipeline: {e}", exc_info=True)
            return False
        finally:
            logger.info("Full pipeline execution completed")
    
    # Don't run the pipeline automatically - wait for API call
    logger.info("Module3 server started. Waiting for API call to start pipeline...")

    yield

def run_clustering() -> bool:
    """Run the clustering process after perspectives are generated.
    
    Returns:
        True if clustering completed successfully, False otherwise
    """
    clustering_file = Path(__file__).parent / "modules" / "TOP-N_K_MEANS-CLUSTERING.py"
    
    try:
        result = subprocess.run(
            [sys.executable, str(clustering_file)],
            cwd=os.path.dirname(__file__),
            check=True,
            capture_output=True,
            text=True
        )
        logger.info("Clustering completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Clustering failed with exit code {e.returncode}: {e.stderr}")
        return False
    except Exception as e:
        logger.error(f"Error running clustering: {e}", exc_info=True)
        return False

app = FastAPI(
    title="Module3 Perspective Generation API",
    version="1.0.0",
    description="API for generating and streaming political perspectives",
    lifespan=lifespan
)

# Add CORS middleware to allow frontend access
# Build allowed origins from config
allowed_origins = []
if config:
    frontend_url = config.get_frontend_url()
    allowed_origins.append(frontend_url)
    # Also add localhost variants for development
    frontend_port = config.get_frontend_port()
    allowed_origins.extend([
        f"http://localhost:{frontend_port}",
        f"http://127.0.0.1:{frontend_port}"
    ])
else:
    # Fallback origins if config not available
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

# Global pipeline state
pipeline_running = False

@app.post("/api/run_pipeline_stream")
async def run_pipeline_stream() -> JSONResponse:
    """Trigger perspective generation pipeline and notify frontend via POST requests.
    
    Returns:
        JSONResponse with status
    """
    global pipeline_running
    
    def run_full_pipeline():
        """Run the complete pipeline in background."""
        global pipeline_running
        
        try:
            pipeline_running = True
            logger.info("Starting perspective generation pipeline")
            
            # Clear old clustering files to ensure fresh state
            base_dir = Path(__file__).parent
            final_output_dir = base_dir / "final_output"
            for filename in ["leftist.json", "rightist.json", "common.json"]:
                file_path = final_output_dir / filename
                if file_path.exists():
                    file_path.unlink()
                    logger.info(f"Cleared old {filename}")
            
            # Step 1: Generate perspectives
            args = argparse.Namespace(
                input="input.json",
                output="output.json",
                endpoint=None,
                model=None,
                temperature=0.6
            )
            
            pipeline_code = api_request.run_pipeline(args)
            if pipeline_code != 0:
                logger.error(f"Pipeline failed with exit code {pipeline_code}")
                pipeline_running = False
                return
            
            logger.info("Pipeline completed successfully - output.json generated")
            
            # Step 2: Run clustering
            logger.info("Starting clustering process")
            if not run_clustering():
                logger.error("Clustering failed")
                pipeline_running = False
                return
            
            logger.info("Clustering completed successfully - final_output files generated")
            
            # Mark as complete
            pipeline_running = False
            
            # Verify all files exist
            required_files = ["leftist.json", "rightist.json", "common.json"]
            all_files_exist = all((final_output_dir / f).exists() for f in required_files)
            
            if all_files_exist:
                logger.info("All three perspective files generated successfully")
                
                # Automatically send data to Module 4
                try:
                    logger.info("Sending perspective data to Module 4 backend...")
                    module4_url = "https://idk-backend-382118575811.asia-south1.run.app"
                    
                    perspectives_data = {}
                    for category in required_files:
                        file_path = final_output_dir / category
                        with open(file_path, 'r', encoding='utf-8') as f:
                            perspectives_data[category.replace('.json', '')] = json.load(f)
                    
                    response = requests.post(
                        f"{module4_url}/upload-perspectives",
                        json={
                            "common": perspectives_data.get("common"),
                            "leftist": perspectives_data.get("leftist"),
                            "rightist": perspectives_data.get("rightist")
                        },
                        headers={"Content-Type": "application/json"},
                        timeout=30
                    )
                    
                    if response.status_code == 200:
                        logger.info("Successfully sent perspective data to Module 4")
                    else:
                        logger.warning(f"Module 4 returned status {response.status_code}: {response.text}")
                except Exception as e:
                    logger.warning(f"Failed to send data to Module 4 (non-critical): {e}")
            else:
                logger.warning("Some required files are missing")
                
        except Exception as e:
            logger.error(f"Pipeline execution failed: {e}", exc_info=True)
            pipeline_running = False
    
    # Start pipeline in background thread
    threading.Thread(target=run_full_pipeline, daemon=True).start()
    
    return JSONResponse({"status": "started", "message": "Pipeline started in background"})

@app.post("/api/clear")
async def clear_all_data():
    """Clear all perspective data - for new session"""
    try:
        base_dir = Path(__file__).parent
        final_output_dir = base_dir / "final_output"
        
        files_to_remove = [
            base_dir / "output.json",
            base_dir / "input.json",
            final_output_dir / "leftist.json",
            final_output_dir / "rightist.json",
            final_output_dir / "common.json"
        ]
        
        removed_files = []
        for file_path in files_to_remove:
            if file_path.exists():
                file_path.unlink()
                removed_files.append(file_path.name)
        
        logger.info(f"Cleared {len(removed_files)} files for new session")
        
        return {
            "status": "success",
            "message": "All Module 3 data cleared",
            "files_removed": removed_files
        }
    except Exception as e:
        logger.error(f"Failed to clear data: {e}", exc_info=True)
        return JSONResponse(
            {"error": f"Failed to clear data: {str(e)}"},
            status_code=500
        )

@app.get("/api/status")
async def check_status() -> Dict[str, Any]:
    """Check the current status of the pipeline processing.
    
    Returns:
        Dictionary with status and progress information
    """
    global pipeline_running
    
    base_dir = Path(__file__).parent
    output_exists = (base_dir / "output.json").exists()
    clustering_exists = (base_dir / "final_output" / "common.json").exists()
    
    # Check the pipeline_running flag first
    if pipeline_running:
        return {"status": "processing", "progress": 50, "pipeline_complete": False}
    elif clustering_exists:
        return {"status": "completed", "progress": 100, "pipeline_complete": True}
    elif output_exists:
        return {"status": "processing", "progress": 50, "pipeline_complete": False}
    else:
        return {"status": "idle", "progress": 0, "pipeline_complete": False}

@app.get("/api/output")
async def get_output() -> JSONResponse:
    """Get the current output.json file with all generated perspectives.
    
    Returns:
        JSONResponse with perspectives data or empty structure
    """
    base_dir = Path(__file__).parent
    output_file = base_dir / "output.json"
    
    if not output_file.exists():
        # Return empty structure if file doesn't exist yet
        return JSONResponse({"perspectives": []})
    
    try:
        with open(output_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            logger.debug(f"Successfully loaded output data with {len(data.get('perspectives', []))} perspectives")
            return JSONResponse(data)
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in output file: {e}")
        return JSONResponse({"perspectives": []})
    except IOError as e:
        logger.error(f"File read error for output: {e}")
        return JSONResponse({"perspectives": []})

@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
    """Health check endpoint to verify server is running.
    
    Returns:
        Dictionary with health status information
    """
    return {
        "status": "healthy",
        "server_time": time.time(),
        "backend_version": "1.0.0",
        "pipeline_running": pipeline_running
    }


@app.get("/api/input")
async def get_input() -> JSONResponse:
    """Get input data from input.json file.
    
    Returns:
        JSONResponse with input data or error message
    """
    base_dir = Path(__file__).parent
    input_file = base_dir / "input.json"
    
    if not input_file.exists():
        logger.warning(f"Input file not found: {input_file}")
        return JSONResponse(
            {"error": "Input file not found"},
            status_code=404
        )
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            logger.debug("Successfully loaded input data")
            return data
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in input file: {e}")
        return JSONResponse(
            {"error": f"Invalid JSON in input file"},
            status_code=500
        )
    except IOError as e:
        logger.error(f"File read error for input: {e}")
        return JSONResponse(
            {"error": f"File read error: {str(e)}"},
            status_code=500
        )

@app.get("/module3/output/{category}")
async def get_module3_output(category: str) -> JSONResponse:
    """Get perspective output data from module3 final_output directory.
    
    Args:
        category: One of 'leftist', 'rightist', 'common'
        
    Returns:
        JSONResponse with perspective data or error message
    """
    base_dir = Path(__file__).parent
    output_exists = (base_dir / "output.json").exists()
    clustering_exists = (base_dir / "final_output" / "common.json").exists()
    
    if output_exists and not clustering_exists:
        return JSONResponse(
            {
                "error": "Pipeline is still running. Files from previous run are not accessible.",
                "stage": "processing",
                "progress": 50
            },
            status_code=409
        )
    
    valid_categories = ["leftist", "rightist", "common"]
    if category not in valid_categories:
        return JSONResponse(
            {"error": f"Invalid category. Must be one of {valid_categories}"},
            status_code=400
        )
    
    file_path = base_dir / "final_output" / f"{category}.json"
    
    if not file_path.exists():
        logger.warning(f"Output file not found: {file_path}")
        return JSONResponse(
            {"error": f"{category} output file not found"},
            status_code=404
        )
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            logger.debug(f"Successfully loaded {category} output")
            return data
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {category} file: {e}")
        return JSONResponse(
            {"error": f"Invalid JSON in {category} file"},
            status_code=500
        )
    except IOError as e:
        logger.error(f"File read error for {category}: {e}")
        return JSONResponse(
            {"error": f"File read error: {str(e)}"},
            status_code=500
        )

@app.post("/api/send_to_module4")
async def send_to_module4() -> JSONResponse:
    """Send perspective files to Module 4 backend for debate analysis.
    
    Reads the three perspective files from final_output directory,
    transforms them to the format Module 4 expects,
    and POSTs them to Module 4 backend.
    
    Returns:
        JSONResponse with status of data transfer
    """
    try:
        base_dir = Path(__file__).parent
        final_output_dir = base_dir / "final_output"
        
        required_files = ["leftist.json", "rightist.json", "common.json"]
        for filename in required_files:
            file_path = final_output_dir / filename
            if not file_path.exists():
                logger.error(f"Missing required file: {filename}")
                return JSONResponse(
                    {"error": f"Missing required file: {filename}. Run pipeline first."},
                    status_code=404
                )
        
        perspectives_data = {}
        for category in required_files:
            file_path = final_output_dir / category
            with open(file_path, 'r', encoding='utf-8') as f:
                perspectives_data[category.replace('.json', '')] = json.load(f)
        
        logger.info("Successfully loaded all three perspective files")
        
        # Load input.json data as well
        input_data = None
        input_file = base_dir / "input.json"
        if input_file.exists():
            try:
                with open(input_file, 'r', encoding='utf-8') as f:
                    input_data = json.load(f)
                logger.info(f"Loaded input data: {input_data.get('topic', 'Unknown')}")
            except Exception as e:
                logger.warning(f"Failed to load input.json: {e}")
        
        # Get Module 4 URL from config
        if config:
            module4_url = config.get_module4_url()
        else:
            module4_url = "http://127.0.0.1:8004"
        
        logger.info(f"Sending data to Module 4 at: {module4_url}")
        
        payload = {
            "common": perspectives_data.get("common"),
            "leftist": perspectives_data.get("leftist"),
            "rightist": perspectives_data.get("rightist")
        }
        
        # Add input data if available
        if input_data:
            payload["input"] = input_data
        
        response = requests.post(
            f"{module4_url}/upload-perspectives",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        if response.status_code == 200:
            logger.info("Successfully sent perspective data to Module 4 backend")
            return JSONResponse({
                "status": "success",
                "message": "Perspective data sent to Module 4 successfully",
                "module4_response": response.json()
            })
        else:
            logger.error(f"Module 4 backend returned error: {response.status_code}")
            return JSONResponse(
                {
                    "error": f"Module 4 backend error: {response.status_code}",
                    "details": response.text
                },
                status_code=502
            )
            
    except requests.RequestException as e:
        logger.error(f"Failed to connect to Module 4 backend: {e}")
        return JSONResponse(
            {"error": f"Failed to connect to Module 4 backend: {str(e)}"},
            status_code=503
        )
    except Exception as e:
        logger.error(f"Error sending data to Module 4: {e}", exc_info=True)
        return JSONResponse(
            {"error": f"Internal server error: {str(e)}"},
            status_code=500
        )

if __name__ == "__main__":
    import uvicorn
    
    # Get port from config, fallback to env variable, then default
    if config:
        host = config.get_module3_host()
        port = config.get_module3_port()
    else:
        host = "127.0.0.1"
        port = int(os.getenv("PIPELINE_PORT", 8002))
    
    # When running directly, the lifespan will handle the pipeline execution
    # Just start the server
    logger.info(f"Starting Module3 server on {host}:{port}")
    logger.info("Pipeline will run automatically on server startup via lifespan hook")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )
    
