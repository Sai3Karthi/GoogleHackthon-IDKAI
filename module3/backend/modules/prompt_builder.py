"""
Prompt Builder Module

Handles construction of prompts for perspective generation, including
context building and duplicate avoidance strategies.
"""

import json
import os
from typing import Any, Dict, List, Set


def build_color_prompt(statement: str, items: List[Dict[str, Any]], existing_texts: Set[str], comprehensive_summary: str = "") -> str:
    """
    Build a prompt for generating perspectives of a specific color.
    
    Args:
        statement: The main topic/statement to generate perspectives about
        items: List of perspective slots to fill (with color and bias_x values)
        existing_texts: Set of already generated perspective texts to avoid duplicates
        comprehensive_summary: Context summary from Module2 to inform perspective generation
        
    Returns:
        JSON-formatted prompt string for the model
    """
    used = list(existing_texts)[:120]  # Show recent perspectives to avoid
    color = items[0]["color"] if items else "unknown"
    
    # Build more detailed context to help avoid duplicates
    duplicate_warning = ""
    if used:
        duplicate_warning = (
            f"\n\nIMPORTANT: DO NOT repeat any of these {len(used)} existing perspectives:\n"
            + "\n".join(f"- \"{txt}\"" for txt in used[-10:])  # Show last 10 to save tokens
        )
    
    payload = {
        "input": statement,
        "context": comprehensive_summary if comprehensive_summary else "Analyze from multiple perspectives.",
        "color": color,
        "bias_range": f"{items[0]['bias_x']:.3f} to {items[-1]['bias_x']:.3f}" if len(items) > 1 else f"{items[0]['bias_x']:.3f}",
        "required_count": len(items),
        "items": [{"bias_x": it["bias_x"]} for it in items],
        "existing_perspective_count": len(used),
        "bias_x_note": "bias_x represents a spectrum: lower values (0.0-0.3) are supportive/accepting of the claim, mid values (0.4-0.6) are balanced/neutral, higher values (0.7-1.0) are questioning/skeptical of the claim. Each perspective should reflect its specific bias_x position on this spectrum.",
        "instructions": (
            f"Generate EXACTLY {len(items)} unique {color} perspectives for the statement '{statement}'. "
            f"Each perspective's stance must match its bias_x value on the spectrum. Make perspectives substantive and debate-ready. "
            f"Return ONLY a JSON array with square brackets:\n"
            f"[{{'color':'{color}','bias_x':{items[0]['bias_x']},'significance_y':0.8,'text':'First unique perspective'}}, "
            f"{{'color':'{color}','bias_x':{items[1]['bias_x'] if len(items)>1 else items[0]['bias_x']},'significance_y':0.6,'text':'Second unique perspective'}}]\n\n"
            "CRITICAL RULES:\n"
            f"1. Return EXACTLY {len(items)} objects in a JSON array\n"
            "2. Copy bias_x values EXACTLY as provided\n"  
            "3. Generate significance_y as float 0.0-1.0 (impact score)\n"
            "4. Each text must be COMPLETELY DIFFERENT - no similar phrases\n"
            "5. Use diverse vocabulary, sentence structures, and angles\n"
            "6. Focus on different aspects: economic, social, environmental, practical, etc.\n"
            "7. NO markdown, NO explanations, ONLY the JSON array"
            + duplicate_warning
            + (" " + os.getenv("PROMPT_SUFFIX", "")).strip()
        ),
    }
    return json.dumps(payload, ensure_ascii=False)


def build_repair_prompt(statement: str, repair_items: List[Dict[str, Any]], existing_texts: Set[str]) -> str:
    """
    Build a prompt for repairing problematic perspectives.
    
    Args:
        statement: The main topic/statement
        repair_items: List of items needing repair (color, bias_x, current_text, current_significance)
        existing_texts: Set of texts to avoid duplicating
        
    Returns:
        JSON-formatted repair prompt string
    """
    payload = {
        "input": statement,
        "repair_items": repair_items,
        "avoid_texts": list(existing_texts)[:100],
        "instructions": (
            f"Fix these {len(repair_items)} perspectives. Return ONLY a JSON array with EXACTLY {len(repair_items)} objects:\n"
            "[{\"color\":\"...\",\"bias_x\":...,\"significance_y\":...,\"text\":\"...\"},...]\n"
            "Rules: 1) Copy bias_x EXACTLY 2) significance_y must be 0.0-1.0 float 3) text must be unique and different from avoid_texts"
        )
    }
    return json.dumps(payload, ensure_ascii=False)