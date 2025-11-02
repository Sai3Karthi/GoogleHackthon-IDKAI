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
You are an expert information analyst tasked with creating a clear, comprehensive explanation of the provided information.

INPUT TEXT TO ANALYZE:
"{text}"

INSTRUCTIONS:
- Create a single, clear explanation that captures ALL the information
- NO information should be lost or omitted
- Write in paragraph form - NO bullet points, lists, or subtopics
- Provide context and explain complex concepts clearly
- Make it flow naturally as a cohesive explanation
- Ensure the summary is professional and well-written

REQUIRED OUTPUT FORMAT (JSON):
{{
    "comprehensive_summary": "<single clear explanation covering all information in paragraph form>"
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
