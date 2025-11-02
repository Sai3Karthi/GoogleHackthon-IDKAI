"""Vertex AI perspective generator module.

Generates structured political perspectives using Vertex AI endpoints.
Perspectives are distributed across a bias spectrum and assigned colors
for visualization and analysis.

Output Format:
{
    "input": "<original statement>",
    "perspectives": [
        {"color": "red", "bias_x": 0.0, "significance_y": 1.0, "text": "..."},
        ...
    ]
}

Generation Rules:
- Perspective count: N = ceiling(128 · (s^2.8) + 8) where s is significance [0,1]
- bias_x: Linearly spaced from 0 to 1 inclusive
- significance_y: Computed as 1 - bias_x (impact mapping)
- Colors: 7 colors (red, orange, yellow, green, blue, indigo, violet)
- Duplicate avoidance: Previously generated texts fed back to model
- Model output: JSON array only (no wrapping braces)
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import List, Dict, Any, Set, Optional

# Load configuration
try:
    root_path = Path(__file__).parent.parent.parent.parent
    sys.path.insert(0, str(root_path))
    from config_loader import get_config
    config = get_config()
except Exception as e:
    print(f"Warning: Could not load config: {e}. Using defaults.")
    config = None

import requests

# Load environment variables from root .env file
try:
    import sys
    # module3/backend/main_modules/api_request.py -> root
    root = Path(__file__).parent.parent.parent.parent
    sys.path.insert(0, str(root))
    from utils.env_loader import load_env_file
    
    env_path = root / '.env'
    load_env_file(env_path)
except (ImportError, ValueError):
    # Fallback to dotenv
    try:
        from dotenv import load_dotenv
        # module3/backend/main_modules -> root
        env_path = Path(__file__).parent.parent.parent / '.env'
        load_dotenv(env_path)
    except Exception:
        pass

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

# Import modular components
from modules.vertex_client import build_client, call_model
from modules.json_utils import load_input, write_output, parse_model_output
from modules.prompt_builder import build_color_prompt, build_repair_prompt
from modules.perspective_utils import (
    build_scaffold,
    group_by_color,
    validate_and_categorize_perspectives,
    process_repair_results
)

VERTEX_ENDPOINT_ENV = "VERTEX_ENDPOINT"


def load_config() -> Dict[str, Any]:
    """Load configuration from config.json.
    
    Returns:
        Configuration dictionary
        
    Raises:
        FileNotFoundError: If config.json is not found
        json.JSONDecodeError: If config.json is invalid
    """
    config_path = os.path.join(os.path.dirname(__file__), "..", "config.json")
    with open(config_path, "r", encoding='utf-8') as config_file:
        return json.load(config_file)


def run_pipeline(args: argparse.Namespace) -> int:
    """Main pipeline for generating structured perspectives.
    
    Args:
        args: Namespace object with input, output, endpoint, model, temperature attributes
        
    Returns:
        Exit code (0 for success, 1 for failure)
        
    Raises:
        SystemExit: If endpoint is not provided
    """
    statement, significance = load_input(args.input)
    
    perspective_count = int(math.ceil(128 * (significance ** 2.8) + 8))
    logger.info(
        f"Significance score: {significance:.3f}, "
        f"calculated perspective count: {perspective_count}"
    )
    
    scaffold = build_scaffold(perspective_count)
    
    # Try to get endpoint from args, environment variable, or deprecated model arg
    endpoint = args.endpoint or os.environ.get(VERTEX_ENDPOINT_ENV) or args.model
    if not endpoint:
        logger.error("No endpoint provided. Use --endpoint or set VERTEX_ENDPOINT in .env")
        raise SystemExit("No endpoint provided. Use --endpoint or set VERTEX_ENDPOINT in .env")
    
    try:
        client = build_client(endpoint)
    except Exception as e:
        logger.error(f"Client initialization failed: {e}", exc_info=True)
        return 1
    
    # Clear output.json at start to avoid showing old data
    base_dir = os.path.dirname(__file__)
    output_path = os.path.join(base_dir, "..", args.output)
    if os.path.exists(output_path):
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump({"input": statement, "perspectives": []}, f, indent=2, ensure_ascii=False)
        logger.info("Cleared output.json to start fresh generation")
    
    existing_texts: Set[str] = set()
    all_persp: List[Dict[str, Any]] = []
    color_groups = group_by_color(scaffold)
    
    stream_callback = getattr(args, "stream_callback", None)

    for group in color_groups:
        color_name = group[0]['color']
        logger.info(f"Processing {color_name} perspectives ({len(group)} items)")

        prompt_text = build_color_prompt(statement, group, existing_texts)
        raw = call_model(client, endpoint, prompt_text, temperature=args.temperature)

        try:
            generated = parse_model_output(raw)
        except Exception as e:
            logger.warning(f"{color_name} parse failed, retrying with lower temperature: {e}")
            raw_retry = call_model(client, endpoint, prompt_text, temperature=0.2)
            generated = parse_model_output(raw_retry)

        valid_perspectives, needs_repair = validate_and_categorize_perspectives(
            group, generated, existing_texts
        )

        if needs_repair:
            logger.info(f"Repairing {len(needs_repair)} items for {color_name}")
            repair_batches = [needs_repair[i:i+3] for i in range(0, len(needs_repair), 3)]

            for batch in repair_batches:
                repair_items = []
                for _, slot, gen in batch:
                    repair_items.append({
                        "color": slot["color"],
                        "bias_x": slot["bias_x"],
                        "current_text": gen.get("text", ""),
                        "current_significance": gen.get("significance_y", "")
                    })

                repair_prompt = build_repair_prompt(statement, repair_items, existing_texts)

                try:
                    repair_raw = call_model(
                        client, endpoint, repair_prompt, temperature=0.3, delay_after=1.5
                    )
                    repair_results = parse_model_output(repair_raw)
                    repaired = process_repair_results(batch, repair_results, existing_texts)
                    valid_perspectives.extend(repaired)
                except Exception as e:
                    logger.warning(f"Repair failed for {color_name}, using fallbacks: {e}")
                    from modules.perspective_utils import create_fallback_perspective
                    fallback_perspectives = [
                        create_fallback_perspective(slot) for _, slot, _ in batch
                    ]
                    for fallback in fallback_perspectives:
                        existing_texts.add(fallback["text"])
                    valid_perspectives.extend(fallback_perspectives)

        valid_perspectives.sort(key=lambda x: x["bias_x"])
        all_persp.extend(valid_perspectives)

        # Write incrementally after each color so frontend can poll for updates
        all_persp.sort(key=lambda x: x["bias_x"])
        intermediate_obj = {"input": statement, "perspectives": all_persp}
        write_output(args.output, intermediate_obj)
        logger.info(f"Wrote {len(all_persp)} perspectives to {args.output} after {color_name} batch")

        # Notify frontend that new batch is available
        try:
            import requests
            # Get frontend URL from config
            if config:
                frontend_url = config.get_frontend_url()
                frontend_ports = [config.get_frontend_port()]
            else:
                # Fallback to common frontend ports
                frontend_url = "http://localhost"
                frontend_ports = [3001, 3000]
            
            for port in frontend_ports:
                try:
                    url = f"{frontend_url.rsplit(':', 1)[0]}:{port}/api/perspective-update"
                    requests.post(
                        url,
                        json={
                            "color": color_name,
                            "count": len(all_persp),
                            "batch_size": len(valid_perspectives)
                        },
                        timeout=1
                    )
                    logger.info(f"Notified frontend at {url} of {color_name} batch update")
                    break
                except:
                    continue
        except Exception as e:
            logger.warning(f"Failed to notify frontend: {e}")

        if stream_callback:
            try:
                stream_callback(color_name, valid_perspectives)
            except Exception as e:
                logger.warning(f"Streaming callback failed for {color_name}: {e}")
    
    all_persp.sort(key=lambda x: x["bias_x"])
    final_obj = {"input": statement, "perspectives": all_persp[:len(scaffold)]}
    write_output(args.output, final_obj)
    logger.info(f"Pipeline completed. Generated {len(final_obj['perspectives'])} perspectives")
    
    # Notify frontend that pipeline is complete
    try:
        import requests
        # Get frontend URL from config
        if config:
            frontend_url = config.get_frontend_url()
            frontend_ports = [config.get_frontend_port()]
        else:
            # Fallback to common frontend ports
            frontend_url = "http://localhost"
            frontend_ports = [3001, 3000]
        
        for port in frontend_ports:
            try:
                url = f"{frontend_url.rsplit(':', 1)[0]}:{port}/api/perspective-complete"
                requests.post(
                    url,
                    json={
                        "total_perspectives": len(final_obj['perspectives']),
                        "status": "completed"
                    },
                    timeout=1
                )
                logger.info(f"Notified frontend at {url} of pipeline completion")
                break
            except:
                continue
    except Exception as e:
        logger.warning(f"Failed to notify frontend of completion: {e}")
    
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    """Build command line argument parser.
    
    Returns:
        Configured ArgumentParser instance
    """
    parser = argparse.ArgumentParser(
        description="Generate structured perspectives JSON using Vertex AI"
    )
    parser.add_argument(
        "--input",
        default="input.json",
        help="Input JSON file path"
    )
    parser.add_argument(
        "--output",
        default="output.json",
        help="Output JSON file path"
    )
    parser.add_argument(
        "--endpoint",
        help="Vertex endpoint path. Overrides VERTEX_ENDPOINT env variable"
    )
    parser.add_argument(
        "--model",
        help="(Deprecated) Use --endpoint instead"
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.6,
        help="Sampling temperature (default: 0.6)"
    )
    return parser


def main() -> None:
    """Main entry point for command-line execution."""
    parser = build_arg_parser()
    args = parser.parse_args()
    code = run_pipeline(args)

    try:
        import requests
        # Get orchestrator URL from config
        if config:
            orchestrator_url = config.get_orchestrator_url()
        else:
            orchestrator_url = "http://127.0.0.1:8000"
        
        requests.post(
            f"{orchestrator_url}/api/pipeline_complete",
            json={"status": "done"},
            timeout=10
        )
    except Exception as e:
        logger.warning(f"Failed to notify server: {e}")

    sys.exit(code)


if __name__ == "__main__":
    main()