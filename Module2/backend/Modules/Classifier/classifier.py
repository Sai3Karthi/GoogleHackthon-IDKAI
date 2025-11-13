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
            "Person": "Information about individuals, public figures, personal claims, biographical disputes, or individual behavior that requires verification through personal sources, witnesses, or credible reporting on individuals",
            "Organization": "Information about organizations, companies, institutions, corporate claims, organizational behavior, business practices, or institutional credibility that requires verification through official channels, investigative journalism, or organizational fact-checking",
            "Social": "Information spread through social channels, viral content, community claims, public sentiment, social movements, trending misinformation, or socially-circulated content that requires verification through social news sources, fact-checking organizations, or social media verification",
            "Critical": "Information with immediate safety, security, emergency, or public threat implications that requires urgent verification through emergency services, security agencies, government officials, or crisis management authorities",
            "STEM": "Information that can be IMMEDIATELY fact-checked as objectively true or false using established scientific laws, mathematical principles, or indisputable historical records WITHOUT requiring opinion, interpretation, or external verification. Only use STEM if the claim has NO debate value and can be instantly confirmed or refuted. Example: '2+2=5' is STEM (immediately false). Example: 'This classroom might be fake for PR' is NOT STEM (requires investigation and verification)"
        }
    
    def _create_classification_prompt(self, text: str) -> str:

        prompt = f"""
You are an expert fake news detection classifier analyzing content for IDK-AI, a platform that helps users verify questionable information through multi-perspective debate.

VERIFICATION CATEGORIES:
1. Person: {self.categories['Person']}
2. Organization: {self.categories['Organization']}
3. Social: {self.categories['Social']}
4. Critical: {self.categories['Critical']}
5. STEM: {self.categories['STEM']}

CONTENT TO ANALYZE:
"{text}"

CRITICAL INSTRUCTIONS FOR VERIFICATION REQUEST DETECTION:

IF THE USER IS ASKING A QUESTION (verification request patterns):
- Contains phrases like: "is this real?", "could this be?", "is this fake?", "verify if...", "check if...", "is this true?"
- The user is REQUESTING VERIFICATION, not making an assertion
- In this case, classify based on WHO/WHAT sources should verify it:
  * Person: If it involves an individual's behavior, claims, or actions
  * Organization: If it involves organizational behavior, institutional claims, or corporate actions  
  * Social: If it's viral content, social media spread, or community-circulated information
  * Critical: If it has safety, security, or emergency implications
  * STEM: ONLY if it's an objectively false scientific/mathematical claim with NO debate value (very rare for questions)

DO NOT classify verification requests as STEM just because the topic involves facts or events. Verification requests about factual matters still require investigation and debate.

EXAMPLES:
- "Is this classroom image fake PR?" → Organization: 60%, Social: 30%, Person: 10% (requires institutional investigation)
- "Could this politician have faked this photo?" → Person: 50%, Social: 30%, Organization: 20%
- "Is 2+2=5?" → STEM: 100% (immediately false, no verification needed)
- "Did this company stage this event?" → Organization: 70%, Social: 20%, Person: 10%

CLASSIFICATION LOGIC:
- Think: "What type of verification source would be most reliable for confirming or refuting this?"
- Assign percentage values (0-100) for each verification category
- Percentages MUST sum to exactly 100%
- Higher percentages = that verification method is more critical for this content
- Consider the nature of the claim and what investigation methods would be needed
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
    "reasoning": "<brief explanation of why these verification methods are most appropriate>"
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
