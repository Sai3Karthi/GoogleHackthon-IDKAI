"""
Content analysis and threat detection using Google AI (Gemini + Web Risk).
Enhanced with Gemini 1.5 Flash for context-aware scam detection.
"""
import re
import os
import json
from typing import Dict, Any, List
import logging
from urllib.parse import urlparse
from pathlib import Path
import httpx
import google.generativeai as genai
from dotenv import load_dotenv

# Load from root .env
root_env = Path(__file__).parent.parent.parent / '.env'
load_dotenv(root_env)

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    logger.info("Gemini API configured successfully")
else:
    logger.warning("GEMINI_API_KEY not found - AI analysis will be disabled")

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

async def check_web_risk(url: str) -> Dict[str, Any]:
    """
    Check URL against Google Web Risk API.
    Uses public lookup API for quick threat detection.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                "https://webrisk.googleapis.com/v1/uris:search",
                params={
                    "uri": url,
                    "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
                    "key": GEMINI_API_KEY
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                if "threat" in data:
                    return {
                        "is_malicious": True,
                        "threats": data["threat"].get("threatTypes", []),
                        "source": "google_web_risk"
                    }
            
            return {"is_malicious": False, "threats": [], "source": "google_web_risk"}
    
    except Exception as e:
        logger.warning(f"Web Risk API check failed: {e}")
        return {"is_malicious": False, "threats": [], "error": str(e)}


async def gemini_analyze_content(text: str, url: str = None) -> Dict[str, Any]:
    """
    Use Gemini 2.5 Flash for AI-powered content analysis.
    Returns context-aware threat assessment.
    """
    if not GEMINI_API_KEY:
        logger.warning("Gemini API key not configured, skipping AI analysis")
        return None
    
    try:
        prompt = f"""Analyze this content for potential scams, phishing, fraud, or malicious intent.

Content: {text[:3000]}
URL: {url if url else "N/A"}

Provide a JSON response with:
1. risk_level: "safe", "suspicious", or "dangerous"
2. confidence: float between 0 and 1
3. threats: array of specific threat types detected
4. explanation: brief user-friendly explanation (1-2 sentences)
5. reasoning: detailed analysis of why this is flagged

Focus on:
- Financial scams (crypto, investment fraud, get-rich-quick schemes)
- Phishing attempts (credential theft, fake login pages)
- Social engineering (urgency tactics, fear-based manipulation)
- Misinformation and fake news patterns
- Gambling/betting operations
- Malicious software distribution

Respond ONLY with valid JSON, no markdown formatting."""

        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(prompt)
        
        response_text = response.text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        result = json.loads(response_text)
        
        logger.info(f"Gemini analysis complete: {result.get('risk_level')} (confidence: {result.get('confidence')})")
        return result
    
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Gemini response as JSON: {e}")
        logger.error(f"Raw response: {response.text[:500]}")
        return None
    except Exception as e:
        logger.error(f"Gemini analysis failed: {e}")
        return None


async def gemini_analyze_image(
    image_data: str,
    mime_type: str,
    context_text: str = None,
    url: str = None
) -> Dict[str, Any]:
    """
    Use Gemini 2.5 Flash Vision for multimodal image analysis.
    Detects scam patterns in images: fake screenshots, QR codes, manipulated images.
    """
    if not GEMINI_API_KEY:
        logger.warning("Gemini API key not configured, skipping image analysis")
        return None
    
    try:
        prompt = """Analyze this image for potential scams, fraud, or malicious content.

Look for:
1. Fake payment confirmations or bank transfer screenshots
2. Manipulated/photoshopped images (fake celebrity endorsements, edited IDs)
3. Phishing QR codes or fake payment QR codes
4. Screenshots of fake WhatsApp/Telegram messages (romance scams, investment scams)
5. Misleading graphs/charts for investment schemes
6. Fake product images or deepfake photos
7. Screenshots of fake apps or phishing websites
8. Fake government documents or certificates
9. Lottery/prize notification graphics
10. Fake trading platform screenshots

Also extract any text visible in the image (OCR) and analyze it for scam language.

Provide a JSON response with:
1. risk_level: "safe", "suspicious", or "dangerous"
2. confidence: float between 0 and 1
3. threats: array of specific visual threats detected
4. explanation: brief user-friendly explanation
5. reasoning: detailed analysis of visual elements
6. extracted_text: any text found in the image (OCR)
7. visual_elements: list of suspicious visual elements detected

Respond ONLY with valid JSON, no markdown formatting."""
        
        if context_text:
            prompt += f"\n\nAdditional context provided by user: {context_text[:500]}"
        if url:
            prompt += f"\n\nSource URL: {url}"
        
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        image_part = {
            "mime_type": mime_type,
            "data": image_data
        }
        
        response = model.generate_content([prompt, image_part])
        
        response_text = response.text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        result = json.loads(response_text)
        
        logger.info(f"Gemini image analysis complete: {result.get('risk_level')} (confidence: {result.get('confidence')})")
        return result
    
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Gemini image response as JSON: {e}")
        logger.error(f"Raw response: {response.text[:500]}")
        return None
    except Exception as e:
        logger.error(f"Gemini image analysis failed: {e}")
        return None


async def analyze_content(
    title: str,
    text: str,
    url: str | None,
    config: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Enhanced content analysis combining Google AI with traditional patterns.
    Priority: Web Risk > Gemini AI > Keyword matching
    """
    threats = []
    red_flags = []
    confidence_score = 0.0
    ai_explanation = None
    ai_reasoning = None
    
    if url:
        web_risk_result = await check_web_risk(url)
        if web_risk_result["is_malicious"]:
            return {
                "risk_level": "dangerous",
                "confidence": 0.95,
                "threats": ["google_web_risk_flagged"] + web_risk_result["threats"],
                "recommendation": "BLOCKED: This URL is flagged by Google Web Risk as malicious. Do not visit this site.",
                "details": {
                    "red_flags": ["Flagged by Google Safe Browsing database"],
                    "source": "google_web_risk",
                    "threat_types": web_risk_result["threats"]
                },
                "ai_powered": True
            }
    
    gemini_result = await gemini_analyze_content(f"{title} {text}", url)
    
    if gemini_result:
        ai_explanation = gemini_result.get("explanation", "")
        ai_reasoning = gemini_result.get("reasoning", "")
        
        gemini_risk = gemini_result.get("risk_level", "safe")
        gemini_confidence = float(gemini_result.get("confidence", 0.5))
        gemini_threats = gemini_result.get("threats", [])
        
        threats.extend(gemini_threats)
        confidence_score = gemini_confidence
        
        if gemini_risk == "dangerous":
            risk_level = "dangerous"
            recommendation = ai_explanation or "HIGH RISK: AI analysis detected multiple threat indicators."
        elif gemini_risk == "suspicious":
            risk_level = "suspicious"
            recommendation = ai_explanation or "CAUTION: AI detected potential warning signs."
        else:
            risk_level = "safe"
            recommendation = ai_explanation or "Content appears safe based on AI analysis."
        
        return {
            "risk_level": risk_level,
            "confidence": round(confidence_score, 2),
            "threats": threats,
            "recommendation": recommendation,
            "details": {
                "red_flags": [ai_reasoning] if ai_reasoning else [],
                "ai_explanation": ai_explanation,
                "ai_reasoning": ai_reasoning,
                "text_length": len(text)
            },
            "ai_powered": True
        }
    
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
        red_flags.append("No trust indicators found")
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
        recommendation = "HIGH RISK: Multiple threat indicators detected."
    elif confidence_score >= 0.3 or len(threats) >= 1:
        risk_level = "suspicious"
        recommendation = "CAUTION: Some warning signs detected."
    else:
        risk_level = "safe"
        recommendation = "Content appears relatively safe."
    
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
        },
        "ai_powered": False
    }
