"""
URL validation utilities.
"""
from urllib.parse import urlparse
from typing import Dict, Any
import re

async def validate_url_safety(url: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate URL safety when scraping fails.
    """
    threats = []
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    
    for tld in config["suspicious_tlds"]:
        if domain.endswith(tld):
            threats.append("suspicious_tld")
            break
    
    if parsed.scheme != "https":
        threats.append("no_https")
    
    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', domain):
        threats.append("ip_address")
    
    if len(threats) >= 2:
        risk_level = "dangerous"
        recommendation = "This URL shows multiple security concerns. Do not visit."
    elif len(threats) == 1:
        risk_level = "suspicious"
        recommendation = "This URL has some security concerns. Proceed with caution."
    else:
        risk_level = "safe"
        recommendation = "URL structure appears normal."
    
    return {
        "risk_level": risk_level,
        "threats": threats,
        "recommendation": recommendation,
        "domain": domain,
        "has_ssl": parsed.scheme == "https"
    }
