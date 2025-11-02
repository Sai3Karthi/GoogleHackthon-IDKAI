#!/usr/bin/env python3
"""
Misinformation Triage Tool using Gemini-2.0-Flash Model

This script analyzes text queries and assigns priority scores (0-100) to determine
how urgently a topic needs investigation for potential widespread misinformation.

Author: Generated for GenAI-XChange Project
"""

import re       
import sys
from typing import Optional
import google.generativeai as genai
import os
from dotenv import load_dotenv


def get_triage_score(user_query: str) -> int:
    """
    Analyze a user query and return a misinformation priority score.
    
    Args:
        user_query (str): The text query to analyze for misinformation potential
        
    Returns:
        int: Priority score from 0-100, or -1 if an error occurs
             - 85-100: Critical Priority (public safety, medical dangers, etc.)
             - 60-84: High Priority (elections, political figures, market manipulation)
             - 30-59: Medium Priority (public figures, unconfirmed studies)
             - 5-29: Low Priority (celebrity gossip, entertainment rumors)
             - 0-4: No Priority (personal, nonsensical, silly statements)
    """
    
    # Load from root .env
    from pathlib import Path
    root_dir = Path(__file__).resolve().parents[4]
    env_path = root_dir / ".env"
    load_dotenv(dotenv_path=env_path)
    
    API_KEY = os.getenv("GEMINI_API_KEY")
    
    if not API_KEY:
        print("Error: GEMINI_API_KEY not found in root .env")
        return -1
    
    try:
        # Initialize Vertex AI/Gemini client
        genai.configure(api_key=API_KEY)
        
        # Select the Gemini model with consistent generation config
        generation_config = genai.types.GenerationConfig(
            temperature=0.0,
            top_p=1.0,
            top_k=1,
            max_output_tokens=10,
            stop_sequences=None,
        )
        
        model_name = os.getenv("MODEL_NAME", "gemini-2.5-flash")
        model = genai.GenerativeModel(model_name)
        
        # Define the specific prompt template with detailed scoring criteria
        prompt_template = """You are a Misinformation Triage Analyst. Analyze the query and assign a Priority Score from 0 to 100.

SCORING CRITERIA:
- **90-100:** Immediate public safety threats, deadly medical misinformation, financial market collapse claims
- **80-89:** Major health misinformation, election fraud claims, terrorist threats, economic disasters
- **70-79:** Political corruption of major figures, corporate fraud affecting millions, vaccine misinformation
- **60-69:** Electoral misinformation, climate change denial, drug safety claims, major conspiracy theories
- **50-59:** Unverified scientific claims, local political scandals, corporate misconduct allegations
- **40-49:** Celebrity health claims, minor political rumors, unconfirmed business news
- **30-39:** Entertainment industry rumors, sports controversies, lifestyle misinformation
- **20-29:** Celebrity gossip, product reviews, opinion pieces, general questions
- **10-19:** Personal preferences, entertainment choices, trivial matters
- **0-9:** Personal diary entries, nonsensical text, clearly harmless content

Rules:
1. Medical claims about cures, vaccines, or treatments = minimum 70
2. Financial market predictions or crashes = minimum 75
3. Political election fraud or voting issues = minimum 70
4. Public safety threats or emergencies = minimum 85
5. Celebrity gossip or entertainment = maximum 30
6. Personal opinions or questions = maximum 20
7. Nonsensical or clearly fake content = maximum 10

Output format: Return ONLY the numerical score (0-100). No other text, symbols, or explanations.

QUERY: "{query}"

SCORE:"""

        # Insert user query into the prompt template
        formatted_prompt = prompt_template.format(query=user_query)
        
        # Send request to Gemini API with consistent generation config
        response = model.generate_content(formatted_prompt, generation_config=generation_config)
        
        # Extract and parse the response text
        response_text = response.text.strip()
        
        # Use regex to extract only the numerical score
        # This handles cases where the model might return extra text
        score_match = re.search(r'\b(\d{1,3})\b', response_text)
        
        # Also try to find score after "SCORE:" if present
        if not score_match:
            score_match = re.search(r'SCORE:\s*(\d{1,3})', response_text, re.IGNORECASE)
        
        if score_match:
            score = int(score_match.group(1))
            # Ensure score is within valid range
            if 0 <= score <= 100:
                return score
            else:
                print(f"Warning: Score {score} out of range (0-100), clamping to valid range")
                return max(0, min(100, score))
        else:
            print(f"Error: Could not extract numerical score from response: '{response_text}'")
            return -1
            
    except Exception as e:
        print(f"Error occurred while getting triage score: {str(e)}")
        return -1


def print_analysis_result(query: str, score: int, threshold: int) -> None:
    """
    Print only the score.
    
    Args:
        query (str): The original query analyzed
        score (int): The triage score received
        threshold (int): The investigation threshold
    """
    print(score)


def run_demo_mode():
    """
    Run demonstration mode with predefined test queries.
    """
    # Define diverse test queries to demonstrate capabilities
    test_queries = [
        # Critical Priority Examples (Expected: 85-100)
        "New COVID vaccine causes immediate heart failure in 90% of patients",
        "Stock market will crash tomorrow due to secret government announcement",
        "Drinking bleach cures cancer according to new medical study",
        
        # High Priority Examples (Expected: 60-84)
        "Presidential candidate caught taking bribes from foreign government",
        "Major bank hiding billions in losses before earnings report",
        "Voting machines compromised in upcoming election",
        
        # Medium Priority Examples (Expected: 30-59)
        "Celebrity X secretly funding controversial political movement",
        "New study shows chocolate prevents all diseases",
        "Local mayor involved in corruption scandal",
        
        # Low Priority Examples (Expected: 5-29)
        "Taylor Swift spotted at coffee shop with mystery person",
        "New movie sequel will be terrible according to leaked script",
        "Best pizza toppings according to food critics",
        
        # No Priority Examples (Expected: 0-4)
        "What should I wear to work today?",
        "My cat likes to sleep in the sun",
        "Random nonsensical gibberish text here"
    ]
    
    # Process each test query
    for query in test_queries:
        score = get_triage_score(query)
        print_analysis_result(query, score, 50)


def run_interactive_mode():
    """
    Run interactive mode where user can input their own queries.
    """
    while True:
        try:
            # Get user input
            user_input = input().strip()
            
            # Check for exit commands
            if user_input.lower() in ['quit', 'exit', 'q', '']:
                break
            
            # Get triage score
            score = get_triage_score(user_input)
            
            # Print analysis result
            print_analysis_result(user_input, score, 50)
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(-1)


def main():
    """
    Main execution function with mode selection.
    """
    if len(sys.argv) > 1:
        # Command line argument mode - analyze single query
        query = " ".join(sys.argv[1:])
        score = get_triage_score(query)
        print_analysis_result(query, score, 50)
    else:
        # Interactive mode - continuously accept input
        run_interactive_mode()


if __name__ == "__main__":
    main()
