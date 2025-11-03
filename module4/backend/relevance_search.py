"""
Relevance Search System for Module 4
Converts simple perspective data into enriched data with web-scraped content
"""
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any
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
env_file = root_dir / '.env'
if env_file.exists():
    load_dotenv(env_file)
else:
    print(f"Warning: .env file not found at {env_file}")

try:
    from googleapiclient.discovery import build
except ImportError:
    print("Warning: google-api-python-client not installed. Search functionality will be limited.")
    build = None


class RelevanceSearchSystem:
    def __init__(self, config_path: str = "config.json", data_dir: str = "data"):
        """
        Initialize the relevance search system
        
        Args:
            config_path: Path to configuration file
            data_dir: Directory containing input perspective files
        """
        self.data_dir = Path(data_dir)
        config_file = Path(__file__).parent / config_path
        
        with open(config_file, 'r', encoding='utf-8') as f:
            self.config = json.load(f)
        
        # API keys - prefer environment variables
        self.api_key = os.getenv("WEB_SEARCH_API_KEY")
        if not self.api_key:
            raise ValueError("WEB_SEARCH_API_KEY environment variable not found")
        self.search_engine_id = os.getenv("SEARCH_ENGINE_ID", self.config.get('search_engine_id', ''))
        
        # Configuration
        self.links_per_text = self.config.get('links_per_text', 3)
        self.delay = self.config.get('rate_limiting', {}).get('delay_between_requests', 2)
        self.max_retries = self.config.get('rate_limiting', {}).get('max_retries', 3)
        self.relevance_threshold = self.config.get('gemini_settings', {}).get('relevance_threshold', 0.7)
        
        # Initialize Google Custom Search
        self.search_service = None
        if build and self.api_key and self.search_engine_id:
            try:
                self.search_service = build("customsearch", "v1", developerKey=self.api_key)
                print("Google Custom Search initialized")
            except Exception as e:
                print(f"Warning: Could not initialize Google Custom Search: {e}")
        else:
            print("Warning: Google Custom Search not available - missing API key or search engine ID")
        
        # Initialize Gemini
        self.gemini_model = None
        try:
            if self.api_key:
                genai.configure(api_key=self.api_key)
                model_name = self.config.get('gemini_settings', {}).get('model', 'gemini-2.0-flash')
                self.gemini_model = genai.GenerativeModel(model_name=model_name)
                print(f"Gemini model initialized: {model_name}")
            else:
                print("Warning: WEB_SEARCH_API_KEY not set - Gemini features disabled")
        except Exception as e:
            print(f"Warning: Could not initialize Gemini model: {e}")
        
        # Load input data for topic context
        self.topic = ""
        self.context_text = ""
        input_file = self.data_dir / "input.json"
        if input_file.exists():
            try:
                with open(input_file, 'r', encoding='utf-8') as f:
                    input_data = json.load(f)
                    self.topic = input_data.get('topic', '')
                    self.context_text = input_data.get('text', '')
                    print(f"Topic loaded: {self.topic}")
            except Exception as e:
                print(f"Warning: Could not load input.json: {e}")
        
        # Extract keywords from topic
        self.topic_keywords = self._extract_keywords_from_topic()
        
        # Initialize Selenium WebDriver
        self.driver = None
        try:
            chrome_options = Options()
            chrome_options.add_argument('--headless')
            chrome_options.add_argument('--disable-gpu')
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-blink-features=AutomationControlled')
            chrome_options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            chrome_options.add_argument('--log-level=3')
            
            # Use webdriver-manager for automatic ChromeDriver management
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            print("Selenium WebDriver initialized successfully with webdriver-manager")
        except Exception as e:
            print(f"Warning: Could not initialize Selenium WebDriver: {e}")
            print("Content extraction will be skipped")
            print("Make sure Chrome browser is installed on your system")
        
        # Rate limiting
        self.request_count = 0
        self.minute_start = time.time()
        self.requests_per_minute = self.config.get('gemini_settings', {}).get('requests_per_minute', 10)
    
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
    
    def process_json_file(self, file_path: Path) -> Dict[str, Any]:
        """Process a single perspective JSON file and enrich with web content"""
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        results = []
        
        for idx, item in enumerate(data):
            text = item.get('text', '')
            if not text:
                continue
            
            print(f"\nProcessing {idx + 1}/{len(data)}: {text[:60]}...")
            
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
                    print(f"    PASSED: {link['title'][:50]}... (conf: {relevance_check['confidence']:.2f} >= {self.relevance_threshold})")
                    
                    trust_check = self.check_trust_score(link)
                    print(f"      Trust: {trust_check['trust_score']:.2f} ({trust_check['source_type']})")
                    
                    extracted_content = self.extract_content_from_url(link['link'])
                    print(f"      Extracted {len(extracted_content)} chars")
                    
                    relevant_links.append({
                        'title': link['title'],
                        'link': link['link'],
                        'snippet': link['snippet'],
                        'trust_score': trust_check['trust_score'],
                        'source_type': trust_check['source_type'],
                        'extracted_content': extracted_content
                    })
                    print(f"      ADDED to relevant_links (now have {len(relevant_links)} links)")
                else:
                    reason = f"relevant={relevance_check.get('relevant', 'N/A')}, conf={relevance_check.get('confidence', 0):.2f} < {self.relevance_threshold}"
                    print(f"    REJECTED: {link['title'][:50]}... ({reason})")
                
                time.sleep(self.delay)
            
            results.append({
                'text': item.get('text', ''),
                'bias_x': item.get('bias_x', 0.5),
                'significance_y': item.get('significance_y', 0.5),
                'combined_score': round(item.get('bias_x', 0.5) * item.get('significance_y', 0.5), 4),
                'color': item.get('color', ''),
                'relevant_links': relevant_links
            })
        
        return {
            'source_file': file_path.name,
            'processed_at': datetime.now().isoformat(),
            'total_items': len(data),
            'items': results
        }
    
    def process_all_files(self) -> Dict[str, Any]:
        """Process all perspective files (leftist, rightist, common) and create enriched versions"""
        json_files = ['leftist.json', 'rightist.json', 'common.json']
        all_results = {}
        
        print("=" * 60)
        print("MODULE 4 RELEVANCE SEARCH SYSTEM")
        print("=" * 60)
        print(f"Topic: {self.topic}")
        print(f"Links per text: {self.links_per_text}")
        print(f"Relevance threshold: {self.relevance_threshold}")
        print("=" * 60)
        
        for json_file in json_files:
            file_path = self.data_dir / json_file
            if not file_path.exists():
                print(f"\nWarning: {json_file} not found, skipping...")
                continue
            
            print(f"\n\nProcessing {json_file}...")
            print("-" * 60)
            
            results = self.process_json_file(file_path)
            
            # Save enriched file
            output_file = self.data_dir / f"relevant_{json_file}"
            output_data = {
                'topic': self.topic,
                'source_file': json_file,
                'processed_at': results['processed_at'],
                'total_items': results['total_items'],
                'items': results['items']
            }
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, indent=2, ensure_ascii=False)
            
            print(f"\nSaved: {output_file.name}")
            all_results[json_file] = results
        
        self._print_summary(all_results)
        return all_results
    
    def _print_summary(self, all_results: Dict[str, Any]) -> None:
        """Print processing summary"""
        print("\n" + "=" * 60)
        print("PROCESSING SUMMARY")
        print("=" * 60)
        
        total_relevant = 0
        for json_file, file_data in all_results.items():
            relevant_count = sum(len(item['relevant_links']) for item in file_data['items'])
            total_relevant += relevant_count
            
            print(f"\n{json_file}:")
            print(f"  Total items: {file_data['total_items']}")
            print(f"  Items with relevant links: {relevant_count}")
            print(f"  Output: relevant_{json_file}")
        
        print(f"\nTOTAL RELEVANT LINKS FOUND: {total_relevant}")
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
