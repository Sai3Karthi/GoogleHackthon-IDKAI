"""Relevance enrichment pipeline for Module 4 with parallel execution."""

from __future__ import annotations

import json
import os
import re
import time
import atexit
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv
import google.generativeai as genai
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from webdriver_manager.chrome import ChromeDriverManager

# Load environment variables from root .env file
root_dir = Path(__file__).parent.parent.parent
env_file = root_dir / ".env"
if env_file.exists():
    load_dotenv(env_file)
else:
    print(f"Warning: .env file not found at {env_file}")

try:  # Optional dependency for discovery-based Custom Search
    from googleapiclient.discovery import build
except ImportError:  # pragma: no cover - optional dependency
    print(
        "Warning: google-api-python-client not installed. Falling back to direct HTTP Custom Search calls."
    )
    build = None


@dataclass(frozen=True)
class SearchResult:
    title: str
    link: str
    snippet: str


class RateLimiter:
    """Simple per-minute rate limiter for thread-safe throttling."""

    def __init__(self, requests_per_minute: Optional[float]) -> None:
        self.capacity = max(int(requests_per_minute or 0), 0)
        self.period = 60.0
        self._timestamps: deque[float] = deque()
        self._lock = Lock()

    def acquire(self) -> None:
        if self.capacity <= 0:
            return

        with self._lock:
            now = time.monotonic()
            while self._timestamps and now - self._timestamps[0] >= self.period:
                self._timestamps.popleft()

            if len(self._timestamps) >= self.capacity:
                wait_for = self.period - (now - self._timestamps[0])
                if wait_for > 0:
                    time.sleep(wait_for)
                    now = time.monotonic()
                    while self._timestamps and now - self._timestamps[0] >= self.period:
                        self._timestamps.popleft()

            self._timestamps.append(time.monotonic())


_GLOBAL_EXECUTOR_LOCK = Lock()
_GLOBAL_EXECUTOR: Optional[ThreadPoolExecutor] = None
_GLOBAL_EXECUTOR_SIZE = 0


def _get_shared_executor(max_workers: int) -> ThreadPoolExecutor:
    """Return a process-wide ThreadPoolExecutor capped at max_workers."""

    global _GLOBAL_EXECUTOR, _GLOBAL_EXECUTOR_SIZE

    target = max(1, max_workers)
    with _GLOBAL_EXECUTOR_LOCK:
        if _GLOBAL_EXECUTOR is None:
            _GLOBAL_EXECUTOR = ThreadPoolExecutor(
                max_workers=target,
                thread_name_prefix="module4-relevance",
            )
            _GLOBAL_EXECUTOR_SIZE = target

            def _shutdown_executor() -> None:
                executor = _GLOBAL_EXECUTOR
                if executor:
                    executor.shutdown(wait=False)

            atexit.register(_shutdown_executor)
        elif target > _GLOBAL_EXECUTOR_SIZE:
            print(
                "Warning: Shared executor already initialized with max_workers="
                f"{_GLOBAL_EXECUTOR_SIZE}, requested {target}. Reusing existing pool."
            )

        return _GLOBAL_EXECUTOR


_REPHRASE_CACHE: Dict[str, str] = {}
_REPHRASE_LOCK = Lock()
_SEARCH_CACHE: Dict[str, List[SearchResult]] = {}
_SEARCH_LOCK = Lock()
_RELEVANCE_CACHE: Dict[Tuple[str, str], Dict[str, Any]] = {}
_RELEVANCE_LOCK = Lock()
_TRUST_CACHE: Dict[str, Dict[str, Any]] = {}
_TRUST_LOCK = Lock()
_CONTENT_CACHE: Dict[str, str] = {}
_CONTENT_LOCK = Lock()

_RATE_LIMIT_LOCK = Lock()
_RATE_LIMITERS: Dict[str, RateLimiter] = {}


def _get_shared_rate_limiter(label: str, rpm: Optional[float]) -> RateLimiter:
    value = max(int(rpm or 0), 0)
    with _RATE_LIMIT_LOCK:
        limiter = _RATE_LIMITERS.get(label)
        if limiter is None or limiter.capacity != value:
            limiter = RateLimiter(value)
            _RATE_LIMITERS[label] = limiter
        return limiter


class CustomSearchClient:
    """Wrapper around Google Custom Search with HTTP fallback."""

    def __init__(
        self,
        api_key: str,
        search_engine_id: str,
        settings: Dict[str, Any],
        *,
        max_results: int,
        use_discovery_client: bool = False,
    ) -> None:
        self.api_key = api_key
        self.search_engine_id = search_engine_id
        self.settings = settings or {}
        self.max_results = max(1, max_results)
        self._service = None
        self._service_lock = Lock()

        self._service_disabled_reason: Optional[str] = None

        if use_discovery_client and build and self.api_key and self.search_engine_id:
            try:
                self._service = build(
                    "customsearch",
                    "v1",
                    developerKey=self.api_key,
                    cache_discovery=False,
                )
                print("Google Custom Search discovery client initialized")
            except Exception as exc:  # pragma: no cover - discovery init optional
                self._service = None
                self._service_disabled_reason = f"Discovery client disabled: {exc}"
                print(f"Warning: Could not initialize discovery client: {exc}")
        elif use_discovery_client and not build:
            self._service_disabled_reason = "google-api-python-client not available"

        if not use_discovery_client:
            self._service_disabled_reason = "Discovery client disabled via configuration"

    def search(self, query: str) -> List[SearchResult]:
        if not self.api_key or not self.search_engine_id or not query.strip():
            return []

        if self._service:
            try:
                with self._service_lock:
                    request = self._service.cse().list(**self._build_params(query))
                    payload = request.execute()
                return self._parse_payload(payload)
            except Exception as exc:  # pragma: no cover - discovery client errors
                print(f"Warning: Discovery client request failed: {exc}")
                self._service = None
                self._service_disabled_reason = f"Discovery client error: {exc}"

        return self._http_search(query)

    def _http_search(self, query: str) -> List[SearchResult]:
        params = self._build_params(query)
        url = f"https://www.googleapis.com/customsearch/v1?{urlencode(params)}"
        request = Request(url, headers={"User-Agent": "Mozilla/5.0 IDKAI-Module4"})

        try:
            with urlopen(request, timeout=15) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                payload = json.loads(response.read().decode(charset, errors="ignore"))
        except (HTTPError, URLError, TimeoutError) as exc:
            print(f"Warning: Custom Search HTTP call failed: {exc}")
            return []
        except Exception as exc:  # pragma: no cover - unexpected JSON issues
            print(f"Warning: Unexpected error during Custom Search: {exc}")
            return []

        return self._parse_payload(payload)

    def _build_params(self, query: str) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "key": self.api_key,
            "cx": self.search_engine_id,
            "q": query.strip(),
            "num": min(self.max_results, 10),
        }

        safe = self.settings.get("safe")
        if safe:
            params["safe"] = safe

        language = self.settings.get("language")
        if language:
            params["lr"] = f"lang_{language}" if not str(language).startswith("lang_") else language

        country = self.settings.get("country")
        if country:
            params["gl"] = country

        return params

    def _parse_payload(self, payload: Dict[str, Any]) -> List[SearchResult]:
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            return []

        results: List[SearchResult] = []
        for entry in items:
            link = entry.get("link") or entry.get("formattedUrl")
            title = (entry.get("title") or entry.get("htmlTitle") or "").strip()
            snippet = (entry.get("snippet") or entry.get("htmlSnippet") or "").strip()
            if not link:
                continue
            results.append(SearchResult(title=title, link=link.strip(), snippet=snippet))
            if len(results) >= self.max_results:
                break

        return results


class SeleniumSearchFallback:
    """Lazy Selenium helper used only when Custom Search yields no results."""

    def __init__(self, links_per_text: int, delay_between_requests: float) -> None:
        self.links_per_text = links_per_text
        self.delay_between_requests = max(delay_between_requests, 0.0)
        self._driver: Optional[webdriver.Chrome] = None
        self._driver_lock = Lock()
        self._operation_lock = Lock()

    def search(self, query: str, *, topic_keywords: str) -> List[SearchResult]:
        with self._operation_lock:
            driver = self._ensure_driver()
            if not driver:
                return []

            combined_query = f"{query.strip()} {topic_keywords}".strip()
            if not combined_query:
                return []

            results: List[SearchResult] = []

            for attempt in range(3):
                try:
                    driver.get("https://www.google.com?gl=in&hl=en")
                    time.sleep(1.5)

                    search_box = driver.find_element(By.NAME, "q")
                    search_box.clear()
                    search_box.send_keys(combined_query)
                    search_box.send_keys(Keys.RETURN)
                    time.sleep(2.5)

                    containers = driver.find_elements(By.CSS_SELECTOR, "div.g, div.MjjYud, div.yuRUbf")
                    for container in containers:
                        try:
                            link_element = container.find_element(By.CSS_SELECTOR, "a")
                            href = link_element.get_attribute("href")
                            text = link_element.text.strip()
                        except Exception:
                            continue

                        if not href or not text:
                            continue

                        if "/url?q=" in href:
                            start = href.find("/url?q=") + 7
                            end = href.find("&", start)
                            end = end if end != -1 else len(href)
                            href = href[start:end]

                        if "google.com" in href or href.startswith("/"):
                            continue

                        results.append(SearchResult(title=text[:120], link=href, snippet=""))
                        if len(results) >= self.links_per_text:
                            return results

                    if results:
                        return results

                    time.sleep(self.delay_between_requests or 1.0)
                except Exception:
                    if attempt == 2:
                        return []
                    time.sleep(1.0 + attempt)

            return results

    def extract_content(self, url: str) -> Optional[str]:
        with self._operation_lock:
            driver = self._ensure_driver()
            if not driver:
                return None

            try:
                driver.get(url)
                time.sleep(2.0)
                body = driver.find_element(By.TAG_NAME, "body")
                text = " ".join(body.text.split())
                return text[:5000] if text else None
            except Exception as exc:
                return f"Error extracting content: {str(exc)[:100]}"

    def close(self) -> None:
        with self._driver_lock:
            if self._driver:
                try:
                    self._driver.quit()
                except Exception:
                    pass
                self._driver = None

    def _ensure_driver(self) -> Optional[webdriver.Chrome]:
        with self._driver_lock:
            if self._driver:
                return self._driver

            try:
                chrome_options = Options()
                chrome_options.add_argument("--headless=new")
                chrome_options.add_argument("--disable-gpu")
                chrome_options.add_argument("--no-sandbox")
                chrome_options.add_argument("--disable-dev-shm-usage")
                chrome_options.add_argument("--disable-blink-features=AutomationControlled")
                chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                chrome_options.add_argument("--log-level=3")

                service = Service(ChromeDriverManager().install())
                self._driver = webdriver.Chrome(service=service, options=chrome_options)
                print("Selenium WebDriver initialized for fallback enrichment")
            except Exception as exc:
                print(f"Warning: Selenium WebDriver unavailable: {exc}")
                self._driver = None

            return self._driver


class RelevanceSearchSystem:
    """High-level enrichment coordinator for Module 4."""

    _SCRIPT_RE = re.compile(r"<script\b[^<]*(?:(?!</script>)<[^<]*)*</script>", flags=re.IGNORECASE)
    _STYLE_RE = re.compile(r"<style\b[^<]*(?:(?!</style>)<[^<]*)*</style>", flags=re.IGNORECASE)
    _TAG_RE = re.compile(r"<[^>]+>")

    def __init__(
        self,
        config_path: str = "config.json",
        data_dir: str = "data",
        *,
        perspective_payload: Optional[Dict[str, List[Dict[str, Any]]]] = None,
        topic: Optional[str] = None,
        context_text: Optional[str] = None,
        force_refresh: bool = False,
    ) -> None:
        self.data_dir = Path(data_dir)
        self.perspective_payload = perspective_payload
        self.topic = topic or ""
        self.context_text = context_text or ""
        self.force_refresh = force_refresh

        config_file = Path(__file__).parent / config_path
        with open(config_file, "r", encoding="utf-8") as handle:
            self.config = json.load(handle)

        self.api_key = os.getenv("WEB_SEARCH_API_KEY")
        if not self.api_key:
            raise ValueError("WEB_SEARCH_API_KEY environment variable not found")

        self.search_engine_id = os.getenv("SEARCH_ENGINE_ID", self.config.get("search_engine_id", ""))

        self.links_per_text = max(1, int(self.config.get("links_per_text", 5)))
        self.max_retries = max(1, int(self.config.get("rate_limiting", {}).get("max_retries", 3)))

        gemini_settings = self.config.get("gemini_settings", {})
        self.relevance_threshold = float(gemini_settings.get("relevance_threshold", 0.7))

        search_settings = self.config.get("search_settings", {})
        self.parallel_workers = max(1, int(self.config.get("parallel_workers", 6)))
        self.global_parallel_limit = max(
            1,
            int(self.config.get("global_parallel_workers", self.parallel_workers * 2)),
        )
        self.parallel_workers = min(self.parallel_workers, self.global_parallel_limit)
        self.executor = _get_shared_executor(self.global_parallel_limit)

        use_discovery_client = bool(search_settings.get("use_discovery_client", False))
        self.search_client = CustomSearchClient(
            self.api_key,
            self.search_engine_id,
            search_settings,
            max_results=self.links_per_text * 2,
            use_discovery_client=use_discovery_client,
        )

        self.search_limiter = _get_shared_rate_limiter(
            "custom_search",
            search_settings.get("requests_per_minute", 25),
        )
        self.gemini_limiter = _get_shared_rate_limiter(
            "gemini",
            gemini_settings.get("requests_per_minute", 30),
        )

        # Shared caches minimise duplicate external calls across concurrent sessions.
        self._rephrase_cache = _REPHRASE_CACHE
        self._search_cache = _SEARCH_CACHE
        self._relevance_cache = _RELEVANCE_CACHE
        self._trust_cache = _TRUST_CACHE
        self._content_cache = _CONTENT_CACHE

        self.use_selenium_fallback = bool(search_settings.get("enable_selenium_fallback", True))
        self.selenium_helper = SeleniumSearchFallback(
            self.links_per_text,
            delay_between_requests=float(self.config.get("rate_limiting", {}).get("delay_between_requests", 1.0)),
        ) if self.use_selenium_fallback else None

        self.topic_keywords = self._extract_keywords_from_topic()

        self.gemini_model = None
        self._gemini_lock = Lock()
        try:
            genai.configure(api_key=self.api_key)
            model_name = gemini_settings.get("model", "gemini-2.0-flash")
            self.gemini_model = genai.GenerativeModel(model_name=model_name)
            print(f"Gemini model initialized: {model_name}")
        except Exception as exc:
            print(f"Warning: Could not initialize Gemini model: {exc}")
            self.gemini_model = None

        if self.perspective_payload is None:
            input_file = self.data_dir / "input.json"
            if input_file.exists() and not self.topic:
                try:
                    with open(input_file, "r", encoding="utf-8") as source:
                        input_data = json.load(source)
                        self.topic = input_data.get("topic", self.topic)
                        self.context_text = input_data.get("text", self.context_text)
                        print(f"Topic loaded from input.json: {self.topic}")
                except Exception as exc:
                    print(f"Warning: Could not load input.json: {exc}")

    def _extract_keywords_from_topic(self) -> str:
        if not self.topic:
            return ""

        stop_words = {
            "a",
            "an",
            "the",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "by",
            "with",
            "from",
            "is",
            "was",
            "are",
            "were",
            "calls",
            "story",
            "news",
        }

        keywords: List[str] = []
        for word in self.topic.split():
            cleaned = word.strip(".,!?:;\"()[]{}").lower()
            if len(cleaned) > 2 and cleaned not in stop_words and not cleaned.isdigit():
                keywords.append(cleaned)

        extracted = " ".join(keywords[:5])
        if extracted:
            print(f"Extracted keywords: {extracted}")
        return extracted

    def rephrase_with_topic_context(self, original_text: str) -> str:
        cache_key = original_text.strip()
        cached: Optional[str]
        if self.force_refresh:
            cached = None
        else:
            with _REPHRASE_LOCK:
                cached = self._rephrase_cache.get(cache_key)
        if cached is not None:
            return cached

        if not self.gemini_model or not original_text.strip():
            with _REPHRASE_LOCK:
                self._rephrase_cache[cache_key] = original_text
            return original_text

        prompt = (
            "Extract the MAIN PHYSICAL INCIDENT/EVENT that is being questioned or criticized.\n\n"
            f"CONTEXT/SUMMARY: {self.context_text if self.context_text else self.topic}\n\n"
            f"PERSPECTIVE: {original_text}\n\n"
            "Instructions:\n"
            "1. Look for the CONCRETE EVENT/OBJECT being discussed (classroom, product launch, policy rollout, etc.)\n"
            "2. Identify WHO is involved (government, company, organization)\n"
            "3. Identify WHERE it happened (location/country if mentioned)\n"
            "4. Identify the KEY CONTROVERSY (fake, staged, misleading, fraud, etc.)\n"
            "5. Create search query with ONLY these elements - NO commentator names\n\n"
            "What to EXCLUDE:\n"
            "- Names of critics/commentators (journalists, YouTubers, activists)\n"
            "- Opinion words (the search should find facts, not opinions)\n\n"
            "What to INCLUDE:\n"
            "- Subject organization/government (Modi, BJP, Company name)\n"
            "- Physical subject (classroom, product, event, policy)\n"
            "- Location (Gujarat, India, City name)\n"
            "- Controversy keywords (fake, staged, cardboard, fraud)\n\n"
            "Examples:\n"
            "Context: 'Critic says Modi government showed fake classroom with cardboard walls in Gujarat'\n"
            "→ Query: 'Modi BJP classroom cardboard fake Gujarat staged'\n\n"
            "Context: 'Whistleblower reveals company product launch was staged'\n"
            "→ Query: 'Company name product launch staged fake controversy'\n\n"
            "Context: 'Activist questions authenticity of government school photos'\n"
            "→ Query: 'Government school photos fake staged authenticity controversy'\n\n"
            "Keep it 8-12 words focusing on THE THING BEING QUESTIONED.\n\n"
            "Respond ONLY with the search query, nothing else."
        )

        for attempt in range(self.max_retries):
            try:
                self.gemini_limiter.acquire()
                with self._gemini_lock:
                    response = self.gemini_model.generate_content(
                        prompt,
                        generation_config={"temperature": 0.3, "max_output_tokens": 150},
                    )
                result = (response.text or original_text).strip()
                if not result:
                    result = original_text
                print(f"[SEARCH QUERY] Generated: '{result}'")
                with _REPHRASE_LOCK:
                    self._rephrase_cache[cache_key] = result
                return result
            except Exception as exc:
                if attempt == self.max_retries - 1:
                    print(f"Error rephrasing ({type(exc).__name__}): {str(exc)[:120]}")
                    break
                time.sleep(2 ** attempt)
        with _REPHRASE_LOCK:
            self._rephrase_cache[cache_key] = original_text
        return original_text

    def search_google(self, query: str, rephrased_query: str) -> List[Dict[str, str]]:
        search_query = f"{rephrased_query} {self.topic_keywords}".strip() or query.strip()
        if not search_query:
            return []

        if self.force_refresh:
            cached_results = None
        else:
            with _SEARCH_LOCK:
                cached_results = self._search_cache.get(search_query)

        if cached_results is not None:
            results = cached_results
        else:
            self.search_limiter.acquire()
            results = self.search_client.search(search_query)
            if not results and self.use_selenium_fallback and self.selenium_helper:
                results = self.selenium_helper.search(search_query, topic_keywords=self.topic_keywords)
            with _SEARCH_LOCK:
                self._search_cache[search_query] = results

        return [
            {
                "title": result.title,
                "link": result.link,
                "snippet": result.snippet,
            }
            for result in results[: self.links_per_text * 2]
        ]

    def check_relevance(self, link_data: Dict[str, str], original_text: str) -> Dict[str, Any]:
        cache_key = (original_text, link_data.get("link", ""))
        if self.force_refresh:
            cached = None
        else:
            with _RELEVANCE_LOCK:
                cached = self._relevance_cache.get(cache_key)
        if cached:
            return cached

        if not self.gemini_model:
            result = {
                "relevant": True,
                "confidence": 0.75,
                "reason": "Gemini unavailable, assuming relevance",
                "link_data": link_data,
            }
            with _RELEVANCE_LOCK:
                self._relevance_cache[cache_key] = result
            return result

        prompt = (
            "Is this article SPECIFICALLY about the incident being discussed?\n\n"
            f"INCIDENT: {self.context_text if self.context_text else self.topic}\n\n"
            "SEARCH RESULT:\n"
            f"Title: {link_data.get('title', '')}\n"
            f"Snippet: {link_data.get('snippet', '')}\n\n"
            "We need content SPECIFICALLY about THIS INCIDENT:\n\n"
            "ACCEPT:\n"
            "- News reports about the incident\n"
            "- Opinion pieces/commentary ABOUT THIS SPECIFIC INCIDENT\n"
            "- Fact-checks of this specific incident\n"
            "- Social media posts/discussions ABOUT THIS SPECIFIC INCIDENT\n"
            "- Analysis/criticism of this specific incident\n"
            "- Photos/videos of the actual incident\n"
            "- Official statements about the incident\n\n"
            "REJECT:\n"
            "- Generic articles about the person/organization (not this incident)\n"
            "- Unrelated incidents or topics\n"
            "- General policy documents\n"
            "- Articles where this incident is not the main focus\n"
            "- Random political discussions that don't mention this incident\n\n"
            "Key question: Does the title/snippet indicate this article is SPECIFICALLY discussing the incident in question?\n\n"
            "Respond in JSON format:\n"
            "{\"relevant\": true/false, \"confidence\": 0.0-1.0, \"reason\": \"brief explanation\"}"
        )

        for attempt in range(self.max_retries):
            try:
                self.gemini_limiter.acquire()
                with self._gemini_lock:
                    response = self.gemini_model.generate_content(
                        prompt,
                        generation_config={"temperature": 0.2, "max_output_tokens": 200},
                    )
                payload = self._safe_parse_json(response.text)
                if not payload:
                    raise ValueError("Empty relevance response")
                payload["link_data"] = link_data
                with _RELEVANCE_LOCK:
                    self._relevance_cache[cache_key] = payload
                return payload
            except Exception as exc:
                if attempt == self.max_retries - 1:
                    print(f"Relevance check error: {str(exc)[:120]}")
                    break
                time.sleep(2 ** attempt)

        fallback = {
            "relevant": False,
            "confidence": 0.0,
            "reason": "Max retries exceeded during relevance check",
            "link_data": link_data,
        }
        with _RELEVANCE_LOCK:
            self._relevance_cache[cache_key] = fallback
        return fallback

    def check_trust_score(self, link_data: Dict[str, str]) -> Dict[str, Any]:
        url = link_data.get("link") or ""
        if self.force_refresh:
            cached = None
        else:
            with _TRUST_LOCK:
                cached = self._trust_cache.get(url)
        if cached is not None:
            return cached

        if not self.gemini_model:
            result = {
                "trust_score": 0.5,
                "source_type": "Unknown",
                "trust_reasoning": "Gemini unavailable",
            }
            with _TRUST_LOCK:
                self._trust_cache[url] = result
            return result

        prompt = (
            "Analyze the trustworthiness of this source.\n\n"
            f"URL: {url}\n"
            f"Title: {link_data.get('title', '')}\n\n"
            "Provide trust score (0.0-1.0) and source type.\n"
            "Respond in JSON format:\n"
            "{\"trust_score\": 0.0-1.0, \"source_type\": \"type\", \"trust_reasoning\": \"brief explanation\"}\n\n"
            "Source types: News Organization, Government, Academic, Social Media, Blog, Forum, Unknown"
        )

        for attempt in range(self.max_retries):
            try:
                self.gemini_limiter.acquire()
                with self._gemini_lock:
                    response = self.gemini_model.generate_content(
                        prompt,
                        generation_config={"temperature": 0.2, "max_output_tokens": 200},
                    )
                payload = self._safe_parse_json(response.text)
                if payload:
                    with _TRUST_LOCK:
                        self._trust_cache[url] = payload
                    return payload
            except Exception as exc:
                if attempt == self.max_retries - 1:
                    print(f"Trust score error: {str(exc)[:120]}")
                    break
                time.sleep(2 ** attempt)

        fallback = {
            "trust_score": 0.3,
            "source_type": "Unknown",
            "trust_reasoning": "Max retries exceeded during trust scoring",
        }
        with _TRUST_LOCK:
            self._trust_cache[url] = fallback
        return fallback

    def extract_content_from_url(self, url: str) -> str:
        if not url:
            return "Invalid URL"

        if self.force_refresh:
            cached = None
        else:
            with _CONTENT_LOCK:
                cached = self._content_cache.get(url)
        if cached is not None:
            return cached

        http_content = self._fetch_content_via_http(url)
        if http_content:
            trimmed = http_content[:5000]
            with _CONTENT_LOCK:
                self._content_cache[url] = trimmed
            return trimmed

        if self.use_selenium_fallback and self.selenium_helper:
            selenium_content = self.selenium_helper.extract_content(url)
            if selenium_content:
                if isinstance(selenium_content, str):
                    trimmed = selenium_content[:5000]
                    with _CONTENT_LOCK:
                        self._content_cache[url] = trimmed
                    return trimmed

        message = "Content could not be extracted"
        with _CONTENT_LOCK:
            self._content_cache[url] = message
        return message

    def _fetch_content_via_http(self, url: str) -> Optional[str]:
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0 IDKAI-Module4"})
            with urlopen(request, timeout=15) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                body = response.read().decode(charset, errors="ignore")
        except Exception:
            return None

        cleaned = self._strip_html(body)
        return cleaned if cleaned else None

    def _strip_html(self, raw_html: str) -> str:
        no_script = self._SCRIPT_RE.sub(" ", raw_html)
        no_style = self._STYLE_RE.sub(" ", no_script)
        text = self._TAG_RE.sub(" ", no_style)
        return re.sub(r"\s+", " ", text).strip()

    def _safe_parse_json(self, candidate: Optional[str]) -> Optional[Dict[str, Any]]:
        if not candidate:
            return None

        stripped = candidate.strip()
        if stripped.startswith("```") and stripped.endswith("```"):
            stripped = "\n".join(stripped.splitlines()[1:-1])

        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end == -1:
            return None

        try:
            return json.loads(stripped[start : end + 1])
        except json.JSONDecodeError:
            return None

    def _normalize_items(self, data: Any) -> List[Dict[str, Any]]:
        if isinstance(data, dict):
            if "items" in data and isinstance(data["items"], list):
                return data["items"]
            return []
        if isinstance(data, list):
            return data
        return []

    def _process_single_item(self, category: str, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        text = str(item.get("text", "")).strip()
        if not text:
            return None

        print(f"Processing {category} perspective: {text[:70]}...")

        rephrased_text = self.rephrase_with_topic_context(text)
        search_results = self.search_google(text, rephrased_text)
        relevant_links: List[Dict[str, Any]] = []

        for link in search_results:
            relevance_check = self.check_relevance(link, text)
            if not relevance_check.get("relevant"):
                continue

            confidence = float(relevance_check.get("confidence", 0.0))
            if confidence < self.relevance_threshold:
                continue

            trust_check = self.check_trust_score(link)
            extracted_content = self.extract_content_from_url(link.get("link", ""))

            relevant_links.append(
                {
                    "title": link.get("title", ""),
                    "link": link.get("link", ""),
                    "snippet": link.get("snippet", ""),
                    "trust_score": float(trust_check.get("trust_score", 0.0)),
                    "source_type": trust_check.get("source_type", "Unknown"),
                    "extracted_content": extracted_content,
                }
            )

            if len(relevant_links) >= self.links_per_text:
                break

        return {
            "text": text,
            "bias_x": item.get("bias_x", 0.5),
            "significance_y": item.get("significance_y", 0.5),
            "combined_score": round(
                float(item.get("bias_x", 0.5)) * float(item.get("significance_y", 0.5)),
                4,
            ),
            "color": item.get("color", ""),
            "relevant_links": relevant_links,
        }

    def _process_items_parallel(
        self,
        category: str,
        items: Iterable[Dict[str, Any]],
    ) -> Dict[str, Any]:
        perspectives = list(items or [])
        if not perspectives:
            return {
                "category": category,
                "source_file": f"{category}.json",
                "processed_at": datetime.now().isoformat(),
                "total_items": 0,
                "items": [],
            }

        enriched_items: List[Dict[str, Any]] = []
        futures = []
        with ThreadPoolExecutor(max_workers=self.parallel_workers) as executor:
            for item in perspectives:
                futures.append(executor.submit(self._process_single_item, category, item))

            for future in as_completed(futures):
                result = future.result()
                if result:
                    enriched_items.append(result)

        return {
            "category": category,
            "source_file": f"{category}.json",
            "processed_at": datetime.now().isoformat(),
            "total_items": len(perspectives),
            "items": enriched_items,
        }

    def _process_items(
        self,
        category: str,
        raw_items: List[Dict[str, Any]],
        *,
        source_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        result = self._process_items_parallel(category, raw_items or [])
        result["source_file"] = source_name or result.get("source_file", f"{category}.json")
        return result

    def process_json_file(self, file_path: Path) -> Dict[str, Any]:
        with open(file_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)

        normalized_items = self._normalize_items(data)
        return self._process_items(file_path.stem, normalized_items, source_name=file_path.name)

    def process_all_files(self) -> Dict[str, Any]:
        categories = ["leftist", "rightist", "common"]
        all_results: Dict[str, Any] = {}

        print("=" * 60)
        print("MODULE 4 RELEVANCE SEARCH SYSTEM")
        print("=" * 60)
        print(f"Topic: {self.topic}")
        print(f"Links per text: {self.links_per_text}")
        print(f"Relevance threshold: {self.relevance_threshold}")
        print(f"Parallel workers: {self.parallel_workers}")
        print("=" * 60)

        if self.perspective_payload is not None:
            for category in categories:
                items = self.perspective_payload.get(category, []) if self.perspective_payload else []
                if not items:
                    print(f"Warning: No {category} perspectives supplied, skipping...")
                    all_results[category] = {
                        "category": category,
                        "source_file": f"{category}.payload",
                        "processed_at": datetime.now().isoformat(),
                        "total_items": 0,
                        "items": [],
                    }
                    continue

                print(f"\nProcessing in-memory payload for {category}...")
                all_results[category] = self._process_items(category, items, source_name=f"{category}.payload")

            self._print_summary(all_results)
            return all_results

        json_files = [f"{category}.json" for category in categories]

        for json_file in json_files:
            file_path = self.data_dir / json_file
            if not file_path.exists():
                print(f"Warning: {json_file} not found, skipping...")
                all_results[file_path.stem] = {
                    "category": file_path.stem,
                    "source_file": json_file,
                    "processed_at": datetime.now().isoformat(),
                    "total_items": 0,
                    "items": [],
                }
                continue

            print(f"\nProcessing {json_file}...")
            result = self.process_json_file(file_path)

            output_file = self.data_dir / f"relevant_{json_file}"
            output_data = {
                "topic": self.topic,
                "source_file": json_file,
                "processed_at": result["processed_at"],
                "total_items": result["total_items"],
                "items": result["items"],
            }

            with open(output_file, "w", encoding="utf-8") as handle:
                json.dump(output_data, handle, indent=2, ensure_ascii=False)

            print(f"Saved enrichment output: {output_file.name}")
            all_results[file_path.stem] = result

        self._print_summary(all_results)
        return all_results

    def _print_summary(self, all_results: Dict[str, Any]) -> None:
        print("\n" + "=" * 60)
        print("PROCESSING SUMMARY")
        print("=" * 60)

        total_links = 0
        for key, file_data in all_results.items():
            items = file_data.get("items", []) if isinstance(file_data, dict) else []
            link_count = sum(len(item.get("relevant_links", [])) for item in items)
            items_with_links = sum(1 for item in items if item.get("relevant_links"))
            total_links += link_count

            label = file_data.get("source_file", key)
            print(f"\n{label}:")
            print(f"  Total items: {file_data.get('total_items', len(items))}")
            print(f"  Items with relevant links: {items_with_links}")
            print(f"  Relevant links found: {link_count}")

        print(f"\nTOTAL RELEVANT LINKS FOUND: {total_links}")
        print("=" * 60)

    def cleanup(self) -> None:
        if self.selenium_helper:
            self.selenium_helper.close()
            print("Selenium WebDriver closed")


def main() -> None:
    base_dir = Path(__file__).parent
    data_dir = base_dir / "data"

    if not data_dir.exists():
        print(f"Error: Data directory not found: {data_dir}")
        return

    system = RelevanceSearchSystem(data_dir=str(data_dir))
    try:
        system.process_all_files()
    finally:
        system.cleanup()


if __name__ == "__main__":
    main()
    
    def _extract_keywords_from_topic(self) -> str:
        """Extract important keywords from topic for search enhancement"""
        if not self.topic:
            return ""
        
        words = self.topic.split()
        important_words = []
        stop_words = {'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'by', 'with', 'from', 'is', 'was', 'are', 'were', 'calls', 'story', 'news'}
        
        for word in words:
            cleaned = word.strip('.,!?:;"()[]{}').lower()
            if len(cleaned) > 2 and cleaned not in stop_words and not cleaned.isdigit():
                important_words.append(cleaned)
        
        keywords = ' '.join(important_words[:5])
        print(f"Extracted keywords: {keywords}")
        return keywords
    
    def _manage_rate_limit(self):
        """Manage API rate limiting"""
        if self.request_count >= self.requests_per_minute:
            elapsed = time.time() - self.minute_start
            if elapsed < 60:
                sleep_time = 60 - elapsed
                print(f"Rate limit reached, waiting {sleep_time:.1f}s...")
                time.sleep(sleep_time)
            self.request_count = 0
            self.minute_start = time.time()
    
    def rephrase_with_topic_context(self, original_text: str) -> str:
        """Rephrase perspective text with topic context for better search results"""
        if not self.gemini_model:
            return original_text
        
        self._manage_rate_limit()
        
        prompt = f"""Rephrase this search query to relate it to the topic, preserving meaning and sentiment.

TOPIC: {self.topic}
ORIGINAL: {original_text}

Rules:
1. Keep core meaning unchanged
2. Connect naturally to topic
3. More specific for better search
4. Concise (under 100 words)
5. Preserve political stance

Respond ONLY with rephrased text."""
        
        for attempt in range(3):
            try:
                response = self.gemini_model.generate_content(
                    prompt,
                    generation_config={'temperature': 0.3, 'max_output_tokens': 150}
                )
                self.request_count += 1
                return response.text.strip()
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                print(f"Error rephrasing: {str(e)[:100]}")
                return original_text
        
        return original_text
    
    def search_google(self, query: str, rephrased_query: str) -> List[Dict[str, str]]:
        """Search Google using Selenium browser automation"""
        if not self.driver:
            print("Selenium WebDriver not available")
            return []

        search_query = f"{rephrased_query} {self.topic_keywords}"
        print(f"Searching Google for: {search_query[:80]}...")

        for attempt in range(self.max_retries):
            try:
                # Navigate to Google with India region
                self.driver.get("https://www.google.com?gl=in&hl=en")
                time.sleep(2)

                # Find search box and enter query
                search_box = self.driver.find_element(By.NAME, "q")
                search_box.clear()
                search_box.send_keys(search_query)
                search_box.send_keys(Keys.RETURN)

                # Wait for results to load
                time.sleep(3)

                # Debug: Check if page loaded correctly
                page_title = self.driver.title
                print(f"Page title: {page_title}")
                if "Google" not in page_title:
                    print("Warning: Page may not have loaded correctly")

                # Debug: Check for CAPTCHA or blocking
                page_source = self.driver.page_source
                if "captcha" in page_source.lower() or "blocked" in page_source.lower():
                    print("Warning: Page appears to be blocked or showing CAPTCHA")
                    return []

                # Extract search results - try different approaches
                results = []

                # Try to find search result containers first
                result_selectors = [
                    "div.g", "div[data-ved]", "div.MjjYud", "div[data-snf]",
                    "div.yuRUbf", "div.ZINbbc", "div.v7W49e"
                ]

                all_containers = []
                for selector in result_selectors:
                    containers = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    all_containers.extend(containers)

                print(f"Found {len(all_containers)} result containers")

                # Extract links from containers
                for container in all_containers[:self.links_per_text * 2]:
                    try:
                        # Find the main link in this container
                        link_elem = container.find_element(By.CSS_SELECTOR, "a")
                        href = link_elem.get_attribute("href")
                        text = link_elem.text.strip()

                        if not href or not text or len(text) < 5:
                            continue

                        # Clean up Google redirects
                        if "/url?q=" in href:
                            start = href.find("/url?q=") + 7
                            end = href.find("&", start)
                            if end == -1:
                                end = len(href)
                            href = href[start:end]

                        # Skip Google links
                        if not href or "google.com" in href or href.startswith("/"):
                            continue

                        results.append({
                            'title': text[:100],
                            'link': href,
                            'snippet': ""
                        })
                        print(f"  Found result: {text[:50]}... -> {href[:50]}...")

                        if len(results) >= self.links_per_text:
                            break

                    except Exception as e:
                        continue

                # If still no results, try the old simple approach but be less restrictive
                if not results:
                    print("Container approach failed, trying fallback...")
                    all_links = self.driver.find_elements(By.CSS_SELECTOR, "a[href]")

                    for link_elem in all_links:
                        try:
                            href = link_elem.get_attribute("href")
                            text = link_elem.text.strip()

                            if not href or not text or len(text) < 10:  # Require longer text
                                continue

                            # Only skip obvious Google navigation, allow search result links
                            if href.startswith("javascript:") or href == "#" or href in ["https://www.google.com/", "https://www.google.com"]:
                                continue

                            # Clean up Google redirects
                            if "/url?q=" in href:
                                start = href.find("/url?q=") + 7
                                end = href.find("&", start)
                                if end == -1:
                                    end = len(href)
                                href = href[start:end]

                            # Allow links that were originally Google redirects
                            if href and "google.com" not in href and not href.startswith("/"):
                                results.append({
                                    'title': text[:100],
                                    'link': href,
                                    'snippet': ""
                                })
                                print(f"  Found result (fallback): {text[:50]}... -> {href[:50]}...")

                                if len(results) >= self.links_per_text:
                                    break

                        except Exception as e:
                            continue

                print(f"Found {len(results)} search results")
                return results

            except Exception as e:
                if attempt < self.max_retries - 1:
                    print(f"Search attempt {attempt + 1} failed: {str(e)[:100]}, retrying...")
                    time.sleep(self.delay * (attempt + 1))
                    continue
                else:
                    print(f"Search failed after {self.max_retries} attempts: {str(e)[:100]}")
                    return []

        return []
    
    def check_relevance(self, link_data: Dict[str, str], original_text: str) -> Dict[str, Any]:
        """Check if a search result is relevant to the original perspective"""
        if not self.gemini_model:
            return {'relevant': True, 'confidence': 0.8, 'reason': 'Gemini unavailable, assuming relevant'}
        
        self._manage_rate_limit()
        
        prompt = f"""Determine if this search result is relevant to the perspective text.

PERSPECTIVE: {original_text}
TOPIC: {self.topic}

SEARCH RESULT:
Title: {link_data.get('title', '')}
Snippet: {link_data.get('snippet', '')}

Is this search result relevant and supportive of the perspective?
Respond in JSON format:
{{"relevant": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}}"""
        
        for attempt in range(3):
            try:
                response = self.gemini_model.generate_content(
                    prompt,
                    generation_config={'temperature': 0.2, 'max_output_tokens': 200}
                )
                self.request_count += 1
                
                result = json.loads(response.text.strip())
                result['link_data'] = link_data
                return result
            except json.JSONDecodeError as je:
                print(f"JSON parsing error: {str(je)[:100]}")
                print(f"Raw response: {response.text[:200]}")
                # Try to extract JSON from markdown-wrapped response
                text = response.text.strip()
                
                # Remove markdown code blocks
                if text.startswith('```'):
                    lines = text.split('\n')
                    if len(lines) > 2:
                        text = '\n'.join(lines[1:-1]) if lines[-1].strip() == '```' else '\n'.join(lines[1:])
                
                # Look for JSON content
                start_idx = text.find('{')
                end_idx = text.rfind('}') + 1
                if start_idx != -1 and end_idx > start_idx:
                    try:
                        json_part = text[start_idx:end_idx]
                        result = json.loads(json_part)
                        result['link_data'] = link_data
                        print(f"    Relevant: {link_data.get('title', 'No title')[:50]}... (conf: {result.get('confidence', 0):.2f})")
                        return result
                    except:
                        pass
                # Fallback: assume relevant with high confidence if we can't parse
                print(f"    Fallback: assuming relevant with high confidence")
                return {'relevant': True, 'confidence': 0.8, 'reason': f'JSON parse error, assuming relevant: {str(je)[:50]}', 'link_data': link_data}
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                print(f"Relevance check error: {str(e)[:100]}")
                return {'relevant': False, 'confidence': 0.0, 'reason': f'Error: {str(e)[:50]}', 'link_data': link_data}
        
        return {'relevant': False, 'confidence': 0.0, 'reason': 'Max retries exceeded', 'link_data': link_data}
    
    def check_trust_score(self, link_data: Dict[str, str]) -> Dict[str, Any]:
        """Determine trust score and source type of a URL"""
        if not self.gemini_model:
            return {'trust_score': 0.5, 'source_type': 'Unknown', 'trust_reasoning': 'Gemini unavailable'}
        
        self._manage_rate_limit()
        
        prompt = f"""Analyze the trustworthiness of this source.

URL: {link_data.get('link', '')}
Title: {link_data.get('title', '')}

Provide trust score (0.0-1.0) and source type.
Respond in JSON format:
{{"trust_score": 0.0-1.0, "source_type": "type", "trust_reasoning": "brief explanation"}}

Source types: News Organization, Government, Academic, Social Media, Blog, Forum, Unknown"""
        
        for attempt in range(3):
            try:
                response = self.gemini_model.generate_content(
                    prompt,
                    generation_config={'temperature': 0.2, 'max_output_tokens': 200}
                )
                self.request_count += 1
                
                return json.loads(response.text.strip())
            except json.JSONDecodeError as je:
                print(f"Trust score JSON parsing error: {str(je)[:100]}")
                print(f"Raw response: {response.text[:200]}")
                # Try to extract JSON from markdown-wrapped response
                text = response.text.strip()
                
                # Remove markdown code blocks
                if text.startswith('```'):
                    lines = text.split('\n')
                    if len(lines) > 2:
                        text = '\n'.join(lines[1:-1]) if lines[-1].strip() == '```' else '\n'.join(lines[1:])
                
                # Look for JSON content
                start_idx = text.find('{')
                end_idx = text.rfind('}') + 1
                if start_idx != -1 and end_idx > start_idx:
                    try:
                        json_part = text[start_idx:end_idx]
                        result = json.loads(json_part)
                        print(f"    Trust: {result.get('source_type', 'Unknown')} (score: {result.get('trust_score', 0):.2f})")
                        return result
                    except:
                        pass
                # Fallback
                print(f"    Fallback: assuming medium trust")
                return {'trust_score': 0.5, 'source_type': 'Unknown', 'trust_reasoning': f'JSON parse error: {str(je)[:50]}'}
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                print(f"Trust score error: {str(e)[:100]}")
                return {'trust_score': 0.3, 'source_type': 'Unknown', 'trust_reasoning': f'Error: {str(e)[:50]}'}
        
        return {'trust_score': 0.3, 'source_type': 'Unknown', 'trust_reasoning': 'Max retries exceeded'}
    
    def extract_content_from_url(self, url: str) -> str:
        """Extract text content from a URL using Selenium"""
        if not self.driver:
            return "Selenium not available - content extraction skipped"
        
        try:
            self.driver.get(url)
            time.sleep(2)
            
            try:
                body = self.driver.find_element(By.TAG_NAME, 'body')
                content = body.text
            except:
                content = self.driver.page_source
            
            content = ' '.join(content.split())
            
            if len(content) > 5000:
                content = content[:5000]
            
            return content if content else "Content could not be extracted"
        except Exception as e:
            return f"Error extracting content: {str(e)[:100]}"
    
    def _normalize_items(self, data: Any) -> List[Dict[str, Any]]:
        if isinstance(data, dict):
            if 'items' in data and isinstance(data['items'], list):
                return data['items']
            return []
        if isinstance(data, list):
            return data
        return []

    def _process_items(
        self,
        category: str,
        raw_items: List[Dict[str, Any]],
        *,
        source_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        items = raw_items or []
        results = []

        for idx, item in enumerate(items, start=1):
            text = item.get('text', '')
            if not text:
                continue

            print(f"\nProcessing {idx}/{len(items)}: {text[:60]}...")

            rephrased_text = self.rephrase_with_topic_context(text)
            print(f"  Rephrased: {rephrased_text[:60]}...")
            time.sleep(self.delay)

            search_results = self.search_google(text, rephrased_text)
            print(f"  Found {len(search_results)} search results")
            time.sleep(self.delay)

            relevant_links = []

            for link in search_results:
                relevance_check = self.check_relevance(link, text)

                if relevance_check['relevant'] and relevance_check['confidence'] >= self.relevance_threshold:
                    print(
                        f"    PASSED: {link['title'][:50]}... (conf: {relevance_check['confidence']:.2f} >= {self.relevance_threshold})"
                    )

                    trust_check = self.check_trust_score(link)
                    print(f"      Trust: {trust_check['trust_score']:.2f} ({trust_check['source_type']})")

                    extracted_content = self.extract_content_from_url(link['link'])
                    print(f"      Extracted {len(extracted_content)} chars")

                    relevant_links.append(
                        {
                            'title': link['title'],
                            'link': link['link'],
                            'snippet': link['snippet'],
                            'trust_score': trust_check['trust_score'],
                            'source_type': trust_check['source_type'],
                            'extracted_content': extracted_content,
                        }
                    )
                    print(f"      ADDED to relevant_links (now have {len(relevant_links)} links)")
                else:
                    reason = (
                        f"relevant={relevance_check.get('relevant', 'N/A')}, "
                        f"conf={relevance_check.get('confidence', 0):.2f} < {self.relevance_threshold}"
                    )
                    print(f"    REJECTED: {link['title'][:50]}... ({reason})")

                time.sleep(self.delay)

            results.append(
                {
                    'text': item.get('text', ''),
                    'bias_x': item.get('bias_x', 0.5),
                    'significance_y': item.get('significance_y', 0.5),
                    'combined_score': round(item.get('bias_x', 0.5) * item.get('significance_y', 0.5), 4),
                    'color': item.get('color', ''),
                    'relevant_links': relevant_links,
                }
            )

        return {
            'category': category,
            'source_file': source_name or f'{category}.json',
            'processed_at': datetime.now().isoformat(),
            'total_items': len(items),
            'items': results,
        }

    def process_json_file(self, file_path: Path) -> Dict[str, Any]:
        """Process a single perspective JSON file and enrich with web content"""
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        normalized_items = self._normalize_items(data)
        return self._process_items(file_path.stem, normalized_items, source_name=file_path.name)

    def process_all_files(self) -> Dict[str, Any]:
        """Process perspective data from disk or in-memory payloads"""
        categories = ['leftist', 'rightist', 'common']
        all_results: Dict[str, Any] = {}

        print("=" * 60)
        print("MODULE 4 RELEVANCE SEARCH SYSTEM")
        print("=" * 60)
        print(f"Topic: {self.topic}")
        print(f"Links per text: {self.links_per_text}")
        print(f"Relevance threshold: {self.relevance_threshold}")
        print("=" * 60)

        if self.perspective_payload is not None:
            for category in categories:
                items = self.perspective_payload.get(category, []) if self.perspective_payload else []
                if not items:
                    print(f"\nWarning: No {category} perspectives supplied, skipping...")
                    continue

                print(f"\n\nProcessing in-memory payload for {category}...")
                print("-" * 60)
                all_results[category] = self._process_items(category, items, source_name=f"{category}.payload")

            self._print_summary(all_results)
            return all_results

        json_files = [f'{category}.json' for category in categories]

        for json_file in json_files:
            file_path = self.data_dir / json_file
            if not file_path.exists():
                print(f"\nWarning: {json_file} not found, skipping...")
                continue

            print(f"\n\nProcessing {json_file}...")
            print("-" * 60)

            result = self.process_json_file(file_path)

            output_file = self.data_dir / f"relevant_{json_file}"
            output_data = {
                'topic': self.topic,
                'source_file': json_file,
                'processed_at': result['processed_at'],
                'total_items': result['total_items'],
                'items': result['items'],
            }

            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, indent=2, ensure_ascii=False)

            print(f"\nSaved: {output_file.name}")
            all_results[file_path.stem] = result

        self._print_summary(all_results)
        return all_results
    
    def _print_summary(self, all_results: Dict[str, Any]) -> None:
        """Print processing summary"""
        print("\n" + "=" * 60)
        print("PROCESSING SUMMARY")
        print("=" * 60)

        total_links = 0
        for key, file_data in all_results.items():
            items = file_data.get('items', [])
            link_count = sum(len(item.get('relevant_links', [])) for item in items)
            items_with_links = sum(1 for item in items if item.get('relevant_links'))
            total_links += link_count

            label = file_data.get('source_file', key)
            print(f"\n{label}:")
            print(f"  Total items: {file_data.get('total_items', len(items))}")
            print(f"  Items with relevant links: {items_with_links}")
            print(f"  Relevant links found: {link_count}")

            source_file = file_data.get('source_file')
            if source_file:
                print(f"  Output: relevant_{Path(source_file).name}")

        print(f"\nTOTAL RELEVANT LINKS FOUND: {total_links}")
        print("=" * 60)
    
    def cleanup(self):
        """Clean up resources"""
        if self.driver:
            try:
                self.driver.quit()
                print("\nSelenium WebDriver closed")
            except:
                pass


def main():
    """Main entry point for standalone execution"""
    base_dir = Path(__file__).parent
    data_dir = base_dir / "data"
    
    if not data_dir.exists():
        print(f"Error: Data directory not found: {data_dir}")
        return
    
    system = RelevanceSearchSystem(data_dir=str(data_dir))
    try:
        system.process_all_files()
    finally:
        system.cleanup()


if __name__ == "__main__":
    main()
