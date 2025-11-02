"""
Web scraping utilities using httpx + selectolax + readability-lxml.
Designed for deployment on serverless/cloud platforms.
"""
import httpx
from selectolax.parser import HTMLParser
from readability import Document
import re
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

async def scrape_url(url: str, timeout: int = 8) -> Dict[str, Any]:
    """
    Scrape a URL and extract title and text content.
    Uses httpx (async) + readability-lxml for article extraction.
    """
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
            headers={"User-Agent": "IDK-AI-Verifier/1.0"}
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            html = response.text
            
        doc = Document(html)
        title = doc.short_title()
        content_html = doc.summary()
        
        parser = HTMLParser(content_html)
        if parser.body:
            text = parser.body.text(strip=True)
        else:
            text = parser.text(strip=True)
        
        return {
            "success": True,
            "title": title,
            "text": text,
            "url": url
        }
    
    except httpx.TimeoutException:
        logger.warning(f"Timeout scraping {url}")
        return {"success": False, "error": "timeout", "url": url}
    except httpx.HTTPStatusError as e:
        logger.warning(f"HTTP error {e.response.status_code} scraping {url}")
        return {"success": False, "error": f"http_{e.response.status_code}", "url": url}
    except Exception as e:
        logger.error(f"Error scraping {url}: {e}")
        return {"success": False, "error": str(e), "url": url}

def detect_input_type(input_text: str) -> str:
    """
    Detect if input is a URL or plain text.
    """
    url_pattern = re.compile(
        r'^https?://'
        r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'
        r'localhost|'
        r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'
        r'(?::\d+)?'
        r'(?:/?|[/?]\S+)$', re.IGNORECASE)
    
    if url_pattern.match(input_text):
        return "url"
    return "text"
