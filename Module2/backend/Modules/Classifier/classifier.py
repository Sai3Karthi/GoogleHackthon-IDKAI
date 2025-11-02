import google.generativeai as genai
import json
import re
import os
from typing import Dict, Any, Optional
from dataclasses import dataclass
from dotenv import load_dotenv


@dataclass
class ClassificationResult:
    person: float
    organization: float
    social: float
    critical: float
    stem: float
    confidence_score: float
    reasoning: str


class FakeNewsDetector:
    
    def __init__(self, api_key: str, model_name: str = None):
        self.api_key = api_key
        genai.configure(api_key=api_key)
        
        # Use provided model_name or get from environment or default
        if model_name is None:
            from pathlib import Path
            root_dir = Path(__file__).resolve().parents[4]
            env_path = root_dir / ".env"
            load_dotenv(dotenv_path=env_path)
            model_name = os.getenv("MODEL_NAME", "gemini-2.5-flash")
        
        self.model = genai.GenerativeModel(model_name)
        
        self.categories = {
            "Person": "Information that requires verification through personal sources, biographical records, individual statements, or personal achievements. Needs checking with the person themselves, family, or official personal records",
            "Organization": "Information that requires verification through organizational sources, company statements, official organizational records, institutional announcements, or corporate communications",
            "Social": "Information that requires verification through social news sources, community reports, social media verification, public event coverage, or social trend analysis",
            "Critical": "Information that requires verification through critical/emergency news sources, official emergency services, government alerts, security agencies, or crisis management authorities",
            "STEM": "Information that can be immediately verified as true or false using established facts, sports history, scientific rules, mathematical principles, historical records, or objective data that doesn't require external news verification"
        }
    
    def _create_classification_prompt(self, text: str) -> str:

        prompt = f"""
You are an expert fake news detection classifier. Analyze the following news/information and classify it based on what type of verification would be needed to confirm if it's true or false.

VERIFICATION CATEGORIES:
1. Person: {self.categories['Person']}
2. Organization: {self.categories['Organization']}
3. Social: {self.categories['Social']}
4. Critical: {self.categories['Critical']}
5. STEM: {self.categories['STEM']}

NEWS/INFORMATION TO CLASSIFY:
"{text}"

INSTRUCTIONS:
- Think: "What type of source would I need to verify if this information is true or false?"
- Assign percentage values (0-100) for each verification category
- Percentages MUST sum to exactly 100%
- STEM = Information that can be verified immediately using facts, sports records, historical data, rules, etc.
- Person = Needs verification from individual sources or personal records
- Organization = Needs verification from company/institutional sources
- Social = Needs verification from social news/community sources
- Critical = Needs verification from emergency/security authorities
- Consider what verification method would be MOST reliable for this specific information
- Provide confidence score (0-100) for overall classification accuracy
- Include brief reasoning for your classification

REQUIRED OUTPUT FORMAT (JSON):
{{
    "person": <percentage as float>,
    "organization": <percentage as float>, 
    "social": <percentage as float>,
    "critical": <percentage as float>,
    "stem": <percentage as float>,
    "confidence_score": <confidence as float>,
    "reasoning": "<brief explanation of verification method logic>"
}}

Ensure your response is valid JSON and percentages sum to 100%.
"""
        return prompt
    
    def _parse_response(self, response_text: str) -> Optional[ClassificationResult]:
        try:
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if not json_match:
                raise ValueError("No JSON found in response")
            
            json_str = json_match.group()
            data = json.loads(json_str)
            
            required_fields = ['person', 'organization', 'social', 'critical', 'stem']
            for field in required_fields:
                if field not in data:
                    raise ValueError(f"Missing required field: {field}")
            
            total = sum(data[field] for field in required_fields)
            if abs(total - 100.0) > 0.1:
                print(f"Warning: Percentages sum to {total}, adjusting to 100%")
                # Normalize to 100%
                factor = 100.0 / total
                for field in required_fields:
                    data[field] *= factor
            
            return ClassificationResult(
                person=float(data['person']),
                organization=float(data['organization']),
                social=float(data['social']),
                critical=float(data['critical']),
                stem=float(data['stem']),
                confidence_score=float(data.get('confidence_score', 95.0)),
                reasoning=str(data.get('reasoning', 'No reasoning provided'))
            )
            
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            print(f"Error parsing response: {e}")
            print(f"Raw response: {response_text}")
            return None
    
    def classify(self, text: str, max_retries: int = 3) -> Optional[ClassificationResult]:
        if not text.strip():
            raise ValueError("Input text cannot be empty")
        
        prompt = self._create_classification_prompt(text)
        
        for attempt in range(max_retries):
            try:
                response = self.model.generate_content(prompt)
                
                if not response.text:
                    raise ValueError("Empty response from API")
                
                result = self._parse_response(response.text)
                if result:
                    return result
                
                print(f"Attempt {attempt + 1} failed, retrying...")
                
            except Exception as e:
                print(f"API call attempt {attempt + 1} failed: {e}")
                if attempt == max_retries - 1:
                    raise
        
        return None
    
    def print_results(self, result: ClassificationResult, text: str = None):        
        print(f"  Person Sources:       {result.person:6.2f}%")
        print(f"  Organization Sources: {result.organization:6.2f}%")
        print(f"  Social Sources:       {result.social:6.2f}%")
        print(f"  Critical Sources:     {result.critical:6.2f}%")
        print(f"  STEM Facts:           {result.stem:6.2f}%")
        print(f"\nConfidence Score: {result.confidence_score:.1f}%")


def main():
    from pathlib import Path
    root_dir = Path(__file__).resolve().parents[4]
    env_path = root_dir / ".env"
    load_dotenv(dotenv_path=env_path)
    
    API_KEY = os.getenv("GEMINI_API_KEY")
    MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash")
    
    if not API_KEY:
        raise ValueError("GEMINI_API_KEY environment variable is required in root .env")
    
    detector = FakeNewsDetector(API_KEY, MODEL_NAME)
    
    while True:
        user_input = input("").strip()
        
        if not user_input:
            break
        
        try:
            result = detector.classify(user_input)
            if result:
                detector.print_results(result, user_input)
            else:
                print("Classification failed. Please try again.")
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    main()
