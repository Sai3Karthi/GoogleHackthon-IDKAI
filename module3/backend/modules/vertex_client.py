"""Vertex AI Client Module.

Handles Vertex AI endpoint validation, client initialization, and model calls
with rate limiting and retry logic. Uses config.json for model parameters.
"""

import json
import os
import re
import time
from typing import Optional, Tuple, List, Dict, Any

import google.genai as genai
from google.genai import types

# Setup logging
try:
    import sys
    sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
    from utils.logger import setup_logger
    logger = setup_logger(__name__)
except ImportError:
    import logging
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter('[%(levelname)s] %(name)s: %(message)s'))
        logger.addHandler(handler)

# Vertex endpoint pattern validation
ENDPOINT_REGEX = re.compile(
    r"^projects/(?P<project>[A-Za-z0-9_-]+)/locations/(?P<location>[a-z0-9-]+)/endpoints/(?P<endpoint>[0-9]+)$"
)


def load_config() -> Dict[str, Any]:
    """Load configuration from config.json file.
    
    Returns:
        Configuration dictionary with defaults if file not found
        
    Raises:
        json.JSONDecodeError: If config file contains invalid JSON
    """
    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.json')
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
            if 'perspective_count' in config:
                config['perspective_count'] = int(config['perspective_count'])
            return config
    except FileNotFoundError:
        logger.warning(f"Config file not found at {config_path}, using defaults")
        return {
            "model_config": {
                "temperature": 0.6,
                "top_p": 0.9,
                "max_output_tokens": 8192,
                "top_k": 40
            },
            "safety_settings": {
                "HARM_CATEGORY_HARASSMENT": "BLOCK_NONE",
                "HARM_CATEGORY_HATE_SPEECH": "BLOCK_NONE",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT": "BLOCK_NONE",
                "HARM_CATEGORY_DANGEROUS_CONTENT": "BLOCK_NONE"
            },
            "generation_config": {
                "candidate_count": 1,
                "stop_sequences": [],
                "response_mime_type": "application/json"
            }
        }
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in config file: {e}")
        raise


def parse_endpoint_path(endpoint: str) -> Optional[Tuple[str, str]]:
    """Parse Vertex AI endpoint path and extract project and location.
    
    Args:
        endpoint: Vertex AI endpoint path
        
    Returns:
        Tuple of (project, location) if valid, None otherwise
    """
    match = ENDPOINT_REGEX.match(endpoint.strip())
    if not match:
        return None
    return match.group("project"), match.group("location")


def build_client(endpoint: str) -> genai.Client:
    """Build and return a Vertex AI client for the given endpoint.
    
    Args:
        endpoint: Vertex AI endpoint path
        
    Returns:
        Initialized genai.Client instance
        
    Raises:
        ValueError: If endpoint path format is invalid
    """
    parsed = parse_endpoint_path(endpoint)
    if not parsed:
        raise ValueError(
            "Endpoint must match pattern: "
            "projects/<project>/locations/<region>/endpoints/<id>"
        )
    project, location = parsed
    
    logger.info(f"Connecting to Vertex AI (project: {project}, location: {location})")
    return genai.Client(vertexai=True, project=project, location=location)


def call_model(
    client: genai.Client, 
    endpoint: str, 
    user_text: str, 
    temperature: Optional[float] = None, 
    delay_after: float = 2.0
) -> str:
    """
    Call the model with retry logic and rate limiting using config.json settings.
    
    Args:
        client: Initialized Vertex AI client
        endpoint: Vertex endpoint path
        user_text: Prompt text to send to model
        temperature: Sampling temperature (overrides config if provided)
        delay_after: Delay in seconds after successful call
        
    Returns:
        Generated text response from model
        
    Raises:
        Exception: If all retries are exhausted or non-rate-limit errors occur
    """
    # Load configuration
    config_data = load_config()
    model_config = config_data.get("model_config", {})
    safety_config = config_data.get("safety_settings", {})
    
    # Use provided temperature or fall back to config
    final_temperature = temperature if temperature is not None else model_config.get("temperature", 0.6)
    
    try:
        part = types.Part.from_text(text=user_text)
    except TypeError:
        part = types.Part(text=user_text)
        
    contents = [types.Content(role="user", parts=[part])]
    
    # Build safety settings from config
    safety_settings = []
    for category, threshold in safety_config.items():
        # Convert threshold values
        threshold_value = "OFF" if threshold == "BLOCK_NONE" else threshold
        safety_settings.append(
            types.SafetySetting(category=category, threshold=threshold_value)
        )
    
    config = types.GenerateContentConfig(
        temperature=final_temperature,
        top_p=model_config.get("top_p", 0.9),
        max_output_tokens=model_config.get("max_output_tokens", 8192),
        top_k=model_config.get("top_k", 40),
        safety_settings=safety_settings,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )
    
    max_retries = 5
    base_delay = 1.0
    
    for attempt in range(max_retries):
        try:
            logger.debug("Generating batch via Vertex AI")
            text_chunks: List[str] = []
            for chunk in client.models.generate_content_stream(
                model=endpoint, contents=contents, config=config
            ):
                if hasattr(chunk, "text") and chunk.text:
                    text_chunks.append(chunk.text)
            
            if delay_after > 0:
                time.sleep(delay_after)
                
            return "".join(text_chunks)
            
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    logger.warning(
                        f"Rate limit hit, retrying in {delay}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    time.sleep(delay)
                    continue
                else:
                    logger.error(f"Max retries exceeded for rate limiting: {e}")
                    raise
            else:
                logger.error(f"API call failed: {e}", exc_info=True)
                raise