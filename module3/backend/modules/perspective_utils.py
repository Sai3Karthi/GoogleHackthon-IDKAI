"""
Perspective Utilities Module

Handles scaffold generation, color assignments, and perspective validation
for the structured perspective generation system.
"""

from typing import Any, Dict, List, Set, Tuple


# Color spectrum for perspective assignment
COLORS = ["red", "orange", "yellow", "green", "blue", "indigo", "violet"]


def build_scaffold(count: int) -> List[Dict[str, Any]]:
    """
    Build a scaffold of perspective slots with bias values and color assignments.
    
    Args:
        count: Total number of perspectives to generate
        
    Returns:
        List of perspective slots with index, color, and bias_x values
        
    Raises:
        ValueError: If count is not positive
    """
    if count <= 0:
        raise ValueError("count must be > 0")
        
    # Even linear biases from 0 to 1
    biases = [i / (count - 1) if count > 1 else 0.5 for i in range(count)]
    
    # Contiguous color segments: divide count into 7 segments as evenly as possible
    base = count // len(COLORS)
    rem = count % len(COLORS)
    segment_sizes = [base + (1 if i < rem else 0) for i in range(len(COLORS))]
    
    # Assign indices to colors
    indices_per_color: List[List[int]] = []
    cursor = 0
    for size in segment_sizes:
        indices_per_color.append(list(range(cursor, cursor + size)))
        cursor += size
    
    # Build scaffold
    scaffold: List[Dict[str, Any]] = []
    for color, idx_list in zip(COLORS, indices_per_color):
        for idx in idx_list:
            b = biases[idx]
            scaffold.append({"index": idx, "color": color, "bias_x": round(b, 4)})
    
    # Sort by index to maintain order
    scaffold.sort(key=lambda x: x["index"])
    return scaffold


def group_by_color(scaffold: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """
    Group scaffold items by color, maintaining color order.
    
    Args:
        scaffold: List of perspective slots with color assignments
        
    Returns:
        List of color groups, each containing perspectives of that color
    """
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for item in scaffold:
        groups.setdefault(item["color"], []).append(item)
    return [groups[c] for c in COLORS if c in groups]


def validate_and_categorize_perspectives(
    group: List[Dict[str, Any]], 
    generated: List[Dict[str, Any]], 
    existing_texts: Set[str]
) -> Tuple[List[Dict[str, Any]], List[Tuple[int, Dict[str, Any], Dict[str, Any]]]]:
    """
    Validate generated perspectives and categorize them into good ones and ones needing repair.
    
    Args:
        group: Original perspective slots to fill
        generated: Generated perspectives from the model
        existing_texts: Set of already used perspective texts
        
    Returns:
        Tuple of (valid_perspectives, items_needing_repair)
        - valid_perspectives: List of properly formatted perspective objects
        - items_needing_repair: List of (index, slot, generated) tuples needing fixes
    """
    valid_perspectives: List[Dict[str, Any]] = []
    needs_repair: List[Tuple[int, Dict[str, Any], Dict[str, Any]]] = []
    
    for i, (slot, gen) in enumerate(zip(group, generated)):
        txt = (gen.get("text") or "").strip()
        sig = gen.get("significance_y")
        
        # Validate significance
        try:
            sig_val = float(sig)
        except (TypeError, ValueError):
            sig_val = -1
            
        # Check if repair is needed
        needs_text_repair = not txt or txt in existing_texts
        needs_sig_repair = not (0.0 <= sig_val <= 1.0)
        
        if needs_text_repair or needs_sig_repair:
            needs_repair.append((i, slot, gen))
        else:
            existing_texts.add(txt)
            valid_perspectives.append({
                "color": slot["color"],
                "bias_x": slot["bias_x"],
                "significance_y": round(sig_val, 4),
                "text": txt,
            })
    
    return valid_perspectives, needs_repair


def create_fallback_perspective(slot: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a fallback perspective when repair fails.
    
    Args:
        slot: Original perspective slot (color, bias_x)
        
    Returns:
        Fallback perspective object with proper text based on bias position
    """
    # Generate proper fallback text based on bias position and color
    bias_x = slot["bias_x"]
    color = slot["color"]
    
    # Create perspective text based on bias position
    if bias_x < 0.2:  # Strong position A (red/orange)
        if color == "red":
            text = "This represents a clear violation of democratic principles and electoral integrity."
        else:
            text = "There are concerning patterns that warrant serious investigation by authorities."
    elif bias_x < 0.4:  # Moderate position A (yellow)
        text = "While allegations deserve attention, we should wait for comprehensive evidence before drawing conclusions."
    elif bias_x < 0.6:  # Neutral/balanced (green)
        text = "This situation requires careful analysis of all available evidence from multiple sources."
    elif bias_x < 0.8:  # Moderate position B (blue)
        text = "These claims may be part of routine political discourse rather than substantive violations."
    else:  # Strong position B (indigo/violet)
        if color == "violet":
            text = "Such accusations are typical political rhetoric without substantial basis in fact."
        else:
            text = "This appears to be standard opposition criticism common in competitive elections."
    
    return {
        "color": slot["color"],
        "bias_x": slot["bias_x"],
        "significance_y": round(0.5 + slot['bias_x'] * 0.3, 4),  # Varied fallback
        "text": text,
    }


def process_repair_results(
    batch: List[Tuple[int, Dict[str, Any], Dict[str, Any]]], 
    repair_results: List[Dict[str, Any]], 
    existing_texts: Set[str]
) -> List[Dict[str, Any]]:
    """
    Process repair results, applying fixes or creating fallbacks as needed.
    
    Args:
        batch: List of items that needed repair
        repair_results: Results from repair model call
        existing_texts: Set of texts to avoid duplicating
        
    Returns:
        List of repaired perspective objects
    """
    repaired_perspectives: List[Dict[str, Any]] = []
    
    for j, (orig_i, slot, gen) in enumerate(batch):
        if j < len(repair_results):
            repaired = repair_results[j]
            rep_txt = (repaired.get("text") or "").strip()
            rep_sig = repaired.get("significance_y")
            
            try:
                rep_sig_val = float(rep_sig) if rep_sig is not None else 0.5
                if not (0.0 <= rep_sig_val <= 1.0):
                    rep_sig_val = 0.5
            except (TypeError, ValueError):
                rep_sig_val = 0.5
                
            if rep_txt and rep_txt not in existing_texts:
                existing_texts.add(rep_txt)
                repaired_perspectives.append({
                    "color": slot["color"],
                    "bias_x": slot["bias_x"],
                    "significance_y": round(rep_sig_val, 4),
                    "text": rep_txt,
                })
            else:
                # Use fallback
                fallback = create_fallback_perspective(slot)
                existing_texts.add(fallback["text"])
                repaired_perspectives.append(fallback)
        else:
            # No repair result, use fallback
            fallback = create_fallback_perspective(slot)
            existing_texts.add(fallback["text"])
            repaired_perspectives.append(fallback)
    
    return repaired_perspectives