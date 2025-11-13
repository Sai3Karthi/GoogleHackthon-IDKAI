import google.generativeai as genai
import json
import re
import os
from typing import Dict, Any, Optional
from dataclasses import dataclass
from dotenv import load_dotenv


@dataclass
class SummaryResult:
    comprehensive_summary: str
    key_points: list
    detailed_explanation: str
    information_retention_score: float
    confidence_score: float


class ComprehensiveSummarizer:
    
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
    
    def _create_summarization_prompt(self, text: str) -> str:
        prompt = f"""
You are an expert information analyst for IDK-AI, a platform that helps users verify questionable information through debate and analysis.

INPUT TO ANALYZE:
"{text}"

YOUR TASK:
Create a comprehensive, neutral summary that captures ALL information while preserving the nature of the content (whether it's an assertion, a question, or a verification request).

CRITICAL RULES FOR CONTEXT PRESERVATION:

1. IDENTIFY THE INPUT TYPE FIRST:
   A. USER VERIFICATION REQUEST: The user is ASKING if something is true/false
      - Indicators: "I asked if...", "Is this true?", "Could this be...", "Verify whether...", "Check if...", "I want to know if..."
   B. THIRD-PARTY ASSERTION: Someone else made a claim (the user is presenting someone else's content for verification)
   C. DIRECT ASSERTION: User is making a claim themselves

2. FOR USER VERIFICATION REQUESTS (Type A) - MOST IMPORTANT:
   - The INPUT ITSELF is a question from the user
   - START with: "The user is questioning whether..." or "The user requests verification of..." or "The user asks if..."
   - DO NOT describe the underlying content as if the user is asserting it
   - Focus on WHAT THE USER IS QUESTIONING, not what someone else claimed
   - Example WRONG: "Dhruv Rathee posted on Twitter criticizing a classroom as fake..."
   - Example CORRECT: "The user is questioning whether Dhruv Rathee's claim about a classroom being a PR stunt is accurate, or if it could be propaganda. They request verification of whether the scene is genuinely staged or simply an exhibition that was visited."

3. FOR THIRD-PARTY ASSERTIONS (Type B):
   - Clearly attribute claims to the source
   - Present objectively: "A social media post by [person] claims that..."
   - Include that this is being submitted for verification

4. FOR DIRECT ASSERTIONS (Type C):
   - Summarize the claim neutrally
   - Maintain objectivity for debate analysis

5. NEUTRAL STANCE ALWAYS:
   - Never conclude truth or falsity
   - Present information objectively for debate analysis
   - Distinguish between what is shown/stated vs what is being questioned

6. COMPREHENSIVE COVERAGE:
   - NO information should be lost or omitted
   - Capture ALL context: user's question + underlying content + any additional details
   - Write in clear, flowing paragraph form (NO bullet points or lists)
   - Explain complex concepts clearly for non-expert audiences

REQUIRED OUTPUT FORMAT (JSON):
{{
    "comprehensive_summary": "<single clear explanation that STARTS with the user's verification request if Type A, then provides context about what they're questioning>"
}}

Ensure your response is valid JSON format with only the comprehensive_summary field.
"""
        return prompt
    
    def _parse_response(self, response_text: str) -> Optional[SummaryResult]:
        try:
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if not json_match:
                raise ValueError("No JSON found in response")
            
            json_str = json_match.group()
            data = json.loads(json_str)
            
            if 'comprehensive_summary' not in data:
                raise ValueError("Missing required field: comprehensive_summary")
            
            return SummaryResult(
                comprehensive_summary=str(data['comprehensive_summary']),
                key_points=[],  # No longer used
                detailed_explanation="",  # No longer used
                information_retention_score=float(data.get('information_retention_score', 95.0)),
                confidence_score=float(data.get('confidence_score', 95.0))
            )
            
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            print(f"Error parsing response: {e}")
            print(f"Raw response: {response_text}")
            return None
    
    def summarize(self, text: str, max_retries: int = 3) -> Optional[SummaryResult]:
        if not text.strip():
            raise ValueError("Input text cannot be empty")
        
        prompt = self._create_summarization_prompt(text)
        
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
    
    def print_results(self, result: SummaryResult, original_text: str = None):
        print(f"{result.comprehensive_summary}")



def main():
    from pathlib import Path
    root_dir = Path(__file__).resolve().parents[4]
    env_path = root_dir / ".env"
    load_dotenv(dotenv_path=env_path)
    
    API_KEY = os.getenv("GEMINI_API_KEY")
    MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash")
    
    if not API_KEY:
        raise ValueError("GEMINI_API_KEY environment variable is required in root .env")
    
    summarizer = ComprehensiveSummarizer(API_KEY, MODEL_NAME)
    
    while True:
        user_input = input("").strip()
        
        if not user_input:
            break
        
        try:
            result = summarizer.summarize(user_input)
            if result:
                summarizer.print_results(result, user_input)
            else:
                print("Summarization failed. Please try again.")
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    main()
