"""
Content analysis and threat detection logic.
"""
import re
from typing import Dict, Any, List
import logging
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

async def quick_url_check(url: str) -> Dict[str, Any]:
    """
    Quick URL validation before scraping.
    Checks for known malicious patterns.
    """
    threats = []
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    
    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', domain):
        threats.append("ip_address_url")
    
    if parsed.port and parsed.port not in [80, 443, 8080]:
        threats.append("unusual_port")
    
    if parsed.scheme != "https":
        threats.append("no_https")
    
    if domain.count('.') > 3:
        threats.append("excessive_subdomains")
    
    return {
        "is_malicious": len(threats) >= 2,
        "threats": threats,
        "domain": domain,
        "scheme": parsed.scheme
    }

async def analyze_content(
    title: str,
    text: str,
    url: str | None,
    config: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Analyze content for scam indicators, phishing patterns, etc.
    """
    threats = []
    red_flags = []
    confidence_score = 0.0
    
    combined_text = f"{title} {text}".lower()
    
    scam_matches = sum(1 for keyword in config["scam_keywords"] if keyword in combined_text)
    if scam_matches >= 3:
        threats.append("scam_language")
        red_flags.append(f"Contains {scam_matches} scam-related keywords")
        confidence_score += 0.3
    
    gambling_matches = sum(1 for keyword in config["gambling_keywords"] if keyword in combined_text)
    if gambling_matches >= 2:
        threats.append("gambling_content")
        red_flags.append("Contains gambling-related content")
        confidence_score += 0.2
    
    phishing_matches = sum(1 for pattern in config["phishing_patterns"] if re.search(pattern, combined_text))
    if phishing_matches >= 1:
        threats.append("phishing_indicators")
        red_flags.append("Contains phishing-style language")
        confidence_score += 0.4
    
    urgency_words = ["urgent", "immediately", "act now", "limited time", "expire"]
    urgency_count = sum(1 for word in urgency_words if word in combined_text)
    if urgency_count >= 2:
        threats.append("urgency_tactics")
        red_flags.append("Uses urgency/pressure tactics")
        confidence_score += 0.2
    
    trust_score = sum(1 for indicator in config["trusted_indicators"] if indicator in combined_text)
    if trust_score == 0:
        red_flags.append("No trust indicators found (privacy policy, contact info, etc.)")
        confidence_score += 0.1
    else:
        confidence_score -= 0.1 * trust_score
    
    if url:
        parsed = urlparse(url)
        
        for tld in config["suspicious_tlds"]:
            if parsed.netloc.endswith(tld):
                threats.append("suspicious_domain")
                red_flags.append(f"Uses suspicious TLD: {tld}")
                confidence_score += 0.3
                break
        
        if parsed.scheme != "https":
            threats.append("no_ssl")
            red_flags.append("Not using HTTPS encryption")
            confidence_score += 0.1
    
    confidence_score = min(confidence_score, 0.99)
    
    if confidence_score >= 0.6 or len(threats) >= 3:
        risk_level = "dangerous"
        recommendation = "HIGH RISK: This content shows multiple red flags. Avoid engaging with this site/information."
    elif confidence_score >= 0.3 or len(threats) >= 1:
        risk_level = "suspicious"
        recommendation = "CAUTION: This content shows some warning signs. Proceed with extreme caution and verify information independently."
    else:
        risk_level = "safe"
        recommendation = "This content appears relatively safe, but always exercise caution online."
    
    return {
        "risk_level": risk_level,
        "confidence": round(confidence_score, 2),
        "threats": threats,
        "recommendation": recommendation,
        "details": {
            "red_flags": red_flags,
            "scam_keywords_found": scam_matches,
            "phishing_patterns_found": phishing_matches,
            "trust_indicators_found": trust_score,
            "text_length": len(text)
        }
    }
