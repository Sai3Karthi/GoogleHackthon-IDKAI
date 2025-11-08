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
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse, urlunparse

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


def _extract_statement_and_significance(payload: Dict[str, Any]) -> Tuple[str, float]:
    statement = (
        payload.get("text")
        or payload.get("input")
        or payload.get("topic")
        or ""
    )
    statement = statement.strip()
    if not statement:
        raise ValueError("Input payload must include 'text' or 'topic'.")

    significance_raw = (
        payload.get("significance_score")
        if payload.get("significance_score") is not None
        else payload.get("significance")
    )

    try:
        significance = float(significance_raw) if significance_raw is not None else 0.7
    except (TypeError, ValueError):
        significance = 0.7

    if not (0.0 <= significance <= 1.0):
        logger.warning("Significance %.3f outside [0, 1], clamping to range", significance)
        significance = max(0.0, min(1.0, significance))

    return statement, significance


def generate_perspectives(
    input_payload: Dict[str, Any],
    *,
    endpoint: Optional[str] = None,
    temperature: float = 0.6,
    stream_callback: Optional[Callable[[str, List[Dict[str, Any]]], None]] = None,
    progress_callback: Optional[Callable[[str, List[Dict[str, Any]], List[Dict[str, Any]]], None]] = None,
    output_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate structured perspectives for the supplied input payload."""

    statement, significance = _extract_statement_and_significance(input_payload)

    perspective_count = int(math.ceil(128 * (significance ** 2.8) + 8))
    logger.info(
        "Significance score: %.3f, calculated perspective count: %d",
        significance,
        perspective_count,
    )

    scaffold = build_scaffold(perspective_count)

    resolved_endpoint = endpoint or os.environ.get(VERTEX_ENDPOINT_ENV)
    if not resolved_endpoint:
        raise RuntimeError("No endpoint provided. Set VERTEX_ENDPOINT or supply endpoint explicitly.")

    try:
        client = build_client(resolved_endpoint)
    except Exception as exc:
        logger.error("Client initialization failed: %s", exc, exc_info=True)
        raise

    # Prepare output path if provided
    json_output_path: Optional[str] = None
    if output_path:
        json_output_path = output_path
        try:
            write_output(json_output_path, {"input": statement, "perspectives": []})
            logger.info("Cleared %s to start fresh generation", json_output_path)
        except Exception as exc:
            logger.warning("Unable to clear output file %s: %s", json_output_path, exc)

    existing_texts: Set[str] = set()
    all_perspectives: List[Dict[str, Any]] = []
    color_groups = group_by_color(scaffold)

    for group in color_groups:
        color_name = group[0]["color"]
        logger.info("Processing %s perspectives (%d items)", color_name, len(group))

        prompt_text = build_color_prompt(statement, group, existing_texts)
        raw = call_model(client, resolved_endpoint, prompt_text, temperature=temperature)

        try:
            generated = parse_model_output(raw)
        except Exception as exc:  # noqa: BLE001
            logger.warning("%s parse failed, retrying with lower temperature: %s", color_name, exc)
            raw_retry = call_model(client, resolved_endpoint, prompt_text, temperature=0.2)
            generated = parse_model_output(raw_retry)

        valid_perspectives, needs_repair = validate_and_categorize_perspectives(
            group, generated, existing_texts
        )

        if needs_repair:
            logger.info("Repairing %d items for %s", len(needs_repair), color_name)
            repair_batches = [needs_repair[i : i + 3] for i in range(0, len(needs_repair), 3)]

            for batch in repair_batches:
                repair_items = []
                for _, slot, gen in batch:
                    repair_items.append(
                        {
                            "color": slot["color"],
                            "bias_x": slot["bias_x"],
                            "current_text": gen.get("text", ""),
                            "current_significance": gen.get("significance_y", ""),
                        }
                    )

                repair_prompt = build_repair_prompt(statement, repair_items, existing_texts)

                try:
                    repair_raw = call_model(
                        client,
                        resolved_endpoint,
                        repair_prompt,
                        temperature=0.3,
                        delay_after=1.5,
                    )
                    repair_results = parse_model_output(repair_raw)
                    repaired = process_repair_results(batch, repair_results, existing_texts)
                    valid_perspectives.extend(repaired)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Repair failed for %s, using fallbacks: %s", color_name, exc)
                    from modules.perspective_utils import create_fallback_perspective

                    fallback_perspectives = [
                        create_fallback_perspective(slot) for _, slot, _ in batch
                    ]
                    for fallback in fallback_perspectives:
                        existing_texts.add(fallback["text"])
                    valid_perspectives.extend(fallback_perspectives)

        valid_perspectives.sort(key=lambda x: x["bias_x"])
        all_perspectives.extend(valid_perspectives)

        all_perspectives.sort(key=lambda x: x["bias_x"])
        intermediate_obj = {"input": statement, "perspectives": all_perspectives}

        if json_output_path:
            write_output(json_output_path, intermediate_obj)

        if progress_callback:
            try:
                progress_callback(color_name, valid_perspectives, list(all_perspectives))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Progress callback failed for %s: %s", color_name, exc)

        try:
            target_frontend = config.get_frontend_url() if config else "http://localhost:3000"
            parsed = urlparse(target_frontend)
            target = parsed._replace(path="/api/perspective-update", query="", fragment="")
            url = urlunparse(target)

            requests.post(
                url,
                json={
                    "color": color_name,
                    "count": len(all_perspectives),
                    "batch_size": len(valid_perspectives),
                },
                timeout=1,
            )
            logger.info("Notified frontend at %s of %s batch update", url, color_name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to notify frontend: %s", exc)

        if stream_callback:
            try:
                stream_callback(color_name, valid_perspectives)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Streaming callback failed for %s: %s", color_name, exc)

    all_perspectives.sort(key=lambda x: x["bias_x"])
    final_obj = {"input": statement, "perspectives": all_perspectives[: len(scaffold)]}

    if json_output_path:
        write_output(json_output_path, final_obj)
        logger.info(
            "Pipeline completed. Generated %d perspectives → %s",
            len(final_obj["perspectives"]),
            json_output_path,
        )
    else:
        logger.info(
            "Pipeline completed. Generated %d perspectives",
            len(final_obj["perspectives"]),
        )

    try:
        target_frontend = config.get_frontend_url() if config else "http://localhost:3000"
        parsed = urlparse(target_frontend)
        target = parsed._replace(path="/api/perspective-complete", query="", fragment="")
        url = urlunparse(target)

        requests.post(
            url,
            json={
                "total_perspectives": len(final_obj["perspectives"]),
                "status": "completed",
            },
            timeout=1,
        )
        logger.info("Notified frontend at %s of pipeline completion", url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to notify frontend of completion: %s", exc)

    return final_obj


def run_pipeline(args: argparse.Namespace) -> int:
    """CLI entry point compatible wrapper around ``generate_perspectives``."""

    statement, significance = load_input(args.input)
    input_payload = {
        "input": statement,
        "significance_score": significance,
    }

    try:
        generate_perspectives(
            input_payload,
            endpoint=args.endpoint or args.model,
            temperature=args.temperature,
            stream_callback=getattr(args, "stream_callback", None),
            output_path=args.output,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Pipeline execution failed: %s", exc, exc_info=True)
        return 1

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