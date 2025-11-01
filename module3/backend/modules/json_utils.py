"""JSON Utilities Module.

Handles JSON parsing, validation, and output operations for perspective generation.
Includes robust parsing for various model output formats.
"""

import json
from typing import Any, Dict, List, Optional

# Setup logging
try:
    import os
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


def extract_json_array(raw: str) -> Optional[str]:
    """
    Extract the first complete JSON array from raw text.
    
    Args:
        raw: Raw text that may contain a JSON array
        
    Returns:
        JSON array string if found, None otherwise
    """
    start = raw.find("[")
    if start == -1:
        return None
    depth = 0
    for i, ch in enumerate(raw[start:], start=start):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return raw[start : i + 1]
    return None


def parse_model_output(raw: str) -> List[Dict[str, Any]]:
    """
    Parse model output into a list of perspective objects.
    
    Handles multiple formats:
    - Standard JSON arrays: [{"color":"red",...}, ...]
    - Single objects: {"color":"red",...}
    - Concatenated objects: {"color":"red",...}{"color":"orange",...}
    
    Args:
        raw: Raw text output from the model
        
    Returns:
        List of parsed perspective objects
        
    Raises:
        ValueError: If no valid JSON objects can be parsed
    """
    # Try standard array parsing first
    arr_text = extract_json_array(raw)
    if arr_text:
        try:
            data = json.loads(arr_text)
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass
    
    # Fallback: try to parse as single object or concatenated objects
    raw_clean = raw.strip()
    
    # Case 1: Single object - wrap in array
    if raw_clean.startswith('{') and raw_clean.endswith('}'):
        try:
            obj = json.loads(raw_clean)
            return [obj] if isinstance(obj, dict) else []
        except json.JSONDecodeError:
            pass
    
    # Case 2: Multiple concatenated objects - try to fix
    if raw_clean.startswith('{'):
        # Find all complete JSON objects
        objects = []
        pos = 0
        while pos < len(raw_clean):
            # Find start of next object
            start = raw_clean.find('{', pos)
            if start == -1:
                break
            
            # Find matching closing brace
            depth = 0
            end = start
            for i in range(start, len(raw_clean)):
                if raw_clean[i] == '{':
                    depth += 1
                elif raw_clean[i] == '}':
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            
            if depth == 0:  # Found complete object
                try:
                    obj_text = raw_clean[start:end+1]
                    obj = json.loads(obj_text)
                    if isinstance(obj, dict):
                        objects.append(obj)
                except json.JSONDecodeError:
                    pass
            
            pos = end + 1
        
        if objects:
            return objects
    
    raise ValueError("Could not parse any valid JSON objects from model output")


def write_output(path: str, data: Any) -> None:
    """
    Write data to JSON file with proper formatting.
    
    Args:
        path: Output file path
        data: Data to write (should contain 'perspectives' key)
    """
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    perspective_count = len(data.get("perspectives", []))
    logger.info(f"Generated {perspective_count} perspectives → {path}")


def load_input(path: str) -> tuple:
    """
    Load and validate input JSON file.
    
    Args:
        path: Path to input JSON file
        
    Returns:
        A tuple containing:
          - The statement/topic string from the input
          - The significance score (defaults to 0.7 if not provided)
        
    Raises:
        SystemExit: If input file is invalid or missing required fields
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            input_obj = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        raise SystemExit(f"Failed to load input file {path}: {e}")
    
    # Accept either full JSON with 'input' or simple statement under 'topic'
    statement = input_obj.get("input") or input_obj.get("topic") or ""
    if not statement:
        raise SystemExit("Input JSON must contain 'input' or 'topic' field with the statement.")
    
    # Get significance score, with a default of 0.7 if not provided
    significance = input_obj.get("significance_score", 0.7)
    
    # Validate significance score is between 0 and 1
    if not (0 <= significance <= 1):
        logger.warning(
            f"Significance score {significance} outside range [0,1], clamping to range"
        )
        significance = max(0, min(significance, 1))
    
    return statement, significance