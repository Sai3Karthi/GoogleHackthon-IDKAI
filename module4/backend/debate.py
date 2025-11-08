import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional

import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables from root .env file
root_dir = Path(__file__).parent.parent.parent
env_file = root_dir / '.env'
if env_file.exists():
    load_dotenv(env_file)
else:
    print(f"Warning: .env file not found at {env_file}")


class DebateAgent:
    def __init__(self, name: str, role: str, perspectives: List[Dict] = None, knowledge_files: List[str] = None, api_key: str = None):
        """
        Initialize agent with either perspectives list or knowledge files
        Supports both simple and enriched perspective formats
        """
        self.name = name
        self.role = role
        
        if perspectives is not None:
            # Direct perspectives list (from main.py)
            self.knowledge = self._format_knowledge(perspectives)
        elif knowledge_files is not None:
            # Load from files (legacy/reference method)
            self.knowledge = self._load_knowledge(knowledge_files)
        else:
            raise ValueError("Must provide either perspectives or knowledge_files")
        
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name="gemini-2.0-flash")
    
    def _format_knowledge(self, perspectives: List[Dict]) -> str:
        """Format perspective list into knowledge text - supports simple and enriched formats"""
        knowledge_text = []
        
        for idx, item in enumerate(perspectives, 1):
            knowledge_text.append(f"\n[Perspective {idx}]")
            knowledge_text.append(f"Statement: {item.get('text', '')}")
            knowledge_text.append(f"Bias: {item.get('bias_x', 0)}, Significance: {item.get('significance_y', 0)}")
            
            # If enriched format with relevant links
            relevant_links = item.get('relevant_links', [])
            if relevant_links:
                knowledge_text.append("\nSupporting Evidence:")
                for link in relevant_links:
                    knowledge_text.append(f"  - {link.get('title', '')}")
                    knowledge_text.append(f"    URL: {link.get('link', '')}")
                    knowledge_text.append(f"    Trust Score: {link.get('trust_score', 0.5)} ({link.get('source_type', 'Unknown')})")
                    if link.get('snippet'):
                        knowledge_text.append(f"    Snippet: {link['snippet']}")
                    if link.get('extracted_content'):
                        content_preview = link['extracted_content'][:300].replace('\n', ' ')
                        knowledge_text.append(f"    Content: {content_preview}...")
                    knowledge_text.append("")
            knowledge_text.append("")
        
        return "\n".join(knowledge_text)
    
    def _load_knowledge(self, knowledge_files: List[str]) -> str:
        """Load from enriched JSON files - legacy method for reference compatibility"""
        combined_knowledge = []
        
        for file_path in knowledge_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                    file_info = f"\n=== Knowledge from {data['source_file']} ===\n"
                    file_info += f"Topic: {data['topic']}\n\n"
                    
                    for item in data['items']:
                        file_info += f"Statement: {item['text']}\n"
                        file_info += f"Bias: {item['bias_x']}, Significance: {item['significance_y']}\n"
                        
                        if item['relevant_links']:
                            file_info += "Supporting Evidence:\n"
                            for link in item['relevant_links']:
                                file_info += f"  - {link['title']}\n"
                                file_info += f"    URL: {link['link']}\n"
                                file_info += f"    Trust Score: {link['trust_score']} ({link['source_type']})\n"
                                file_info += f"    Snippet: {link['snippet']}\n"
                                if 'extracted_content' in link:
                                    content_preview = link['extracted_content'][:300]
                                    file_info += f"    Content: {content_preview}...\n"
                                file_info += "\n"
                        file_info += "\n"
                    
                    combined_knowledge.append(file_info)
            except Exception as e:
                print(f"Error loading {file_path}: {e}")
        
        return "\n".join(combined_knowledge)
    
    def make_argument(self, topic: str, debate_context: str = "") -> str:
        prompt = f"""You are {self.name}, representing a {self.role} perspective in a debate.

TOPIC TO DEBATE: {topic}

YOUR KNOWLEDGE BASE:
{self.knowledge}

{debate_context}

Based on your knowledge base, make a clear, evidence-based argument about whether the topic/information is trustworthy.

Rules:
1. Focus ONLY on the topic at hand - not all topics are political
2. Use concrete evidence from your knowledge base (cite sources and trust scores)
3. Your perspective comes from the sources you have access to ({self.role} sources), not from political ideology
4. Be concise and clear - aim for 150-200 words
5. Focus on: source credibility, evidence quality, factual accuracy
6. Explain your reasoning simply and logically

Your argument:"""

        try:
            response = self.model.generate_content(
                prompt,
                generation_config={'temperature': 0.6, 'max_output_tokens': 400}
            )
            return response.text.strip()
        except Exception as e:
            return f"Error generating argument: {str(e)}"
    
    def respond_to_opponent(self, topic: str, opponent_argument: str, debate_history: str) -> str:
        prompt = f"""You are {self.name}, representing a {self.role} perspective in a debate.

TOPIC: {topic}

YOUR KNOWLEDGE BASE:
{self.knowledge}

DEBATE HISTORY:
{debate_history}

OPPONENT'S LATEST ARGUMENT:
{opponent_argument}

Respond to your opponent's argument about the TOPIC. Counter their points with your evidence.

Rules:
1. Stay focused on the topic - "{topic}"
2. Directly address opponent's specific claims with evidence from your knowledge base
3. Point out if their sources are less trustworthy than yours (compare trust scores)
4. Be concise and clear - aim for 150-200 words
5. Use simple language that's easy to understand
6. Don't make it political unless the topic itself is political

Your response:"""

        try:
            response = self.model.generate_content(
                prompt,
                generation_config={'temperature': 0.6, 'max_output_tokens': 400}
            )
            return response.text.strip()
        except Exception as e:
            return f"Error generating response: {str(e)}"


class JudgeAgent:
    def __init__(self, api_key: str):
        self.name = "Judge"
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name="gemini-2.0-flash")
    
    def evaluate_debate(self, topic: str, debate_transcript: str) -> Dict[str, any]:
        prompt = f"""You are an impartial JUDGE evaluating a debate about the trustworthiness of information.

TOPIC: {topic}

FULL DEBATE TRANSCRIPT:
{debate_transcript}

Your task is to provide a final TRUST SCORE from 0-100% based on the debate.

Trust Score Scale:
- 0-20%: Highly untrustworthy - Poor sources, weak evidence, contradictory information
- 21-40%: Mostly untrustworthy - Significant concerns about credibility
- 41-60%: Mixed reliability - Some valid points but major concerns remain
- 61-80%: Mostly trustworthy - Good sources and evidence with minor concerns
- 81-100%: Highly trustworthy - Excellent sources, strong evidence, consistent information

Evaluation Criteria:
- Quality and trustworthiness of sources cited (trust scores)
- Strength of evidence presented by both sides
- Logical consistency of arguments
- Which side had more credible sources and stronger evidence
- Overall credibility of the claims about this specific topic

Provide your judgment in the following format:

TRUST SCORE: [0-100]%

REASONING:
[In 150-200 words, explain your trust score clearly and simply. Analyze both sides' arguments and evidence. Use plain language that anyone can understand.]

KEY FACTORS:
- [List 3-4 key factors that influenced your trust score]

Your judgment:"""

        try:
            response = self.model.generate_content(
                prompt,
                generation_config={'temperature': 0.4, 'max_output_tokens': 600}
            )
            
            text = response.text.strip()
            
            trust_score = 50  # Default to middle if parsing fails
            if "TRUST SCORE:" in text:
                score_line = text.split("TRUST SCORE:")[1].split("\n")[0].strip()
                # Extract number from string like "75%" or "75"
                import re
                numbers = re.findall(r'\d+', score_line)
                if numbers:
                    trust_score = int(numbers[0])
                    # Ensure it's within 0-100
                    trust_score = max(0, min(100, trust_score))
            
            return {
                'trust_score': trust_score,
                'full_judgment': text
            }
        except Exception as e:
            return {
                'trust_score': 0,
                'full_judgment': f"Error generating judgment: {str(e)}"
            }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DebateOrchestrator:
    def __init__(self, config_path: str = "config.json"):
        """Initialize orchestrator - agents created per debate"""
        from pathlib import Path
        import os
        
        config_file = Path(__file__).parent / config_path
        with open(config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        self.api_key = os.getenv("WEB_SEARCH_API_KEY")
        if not self.api_key:
            raise ValueError("WEB_SEARCH_API_KEY environment variable not found")
    
    def conduct_debate(
        self,
        leftist_perspectives: List[Dict],
        rightist_perspectives: List[Dict],
        common_perspectives: List[Dict],
        max_rounds: int = 3,
        min_rounds: int = 1,
        progress_callback: Optional[Callable[[Dict], None]] = None,
    ) -> Dict:
        """
        Conduct debate with perspective data
        Supports both simple and enriched formats
        """
        # Get topic
        topic = "Information Trustworthiness"
        if leftist_perspectives and len(leftist_perspectives) > 0:
            topic = leftist_perspectives[0].get('text', topic)[:100]
        
        def emit(event: str, **payload) -> None:
            if not progress_callback:
                return
            update = {"event": event, "timestamp": _now_iso(), **payload}
            try:
                progress_callback(update)
            except Exception as exc:  # pragma: no cover - defensive
                print(f"[DebateOrchestrator] Progress callback failed: {exc}")

        print(f"Starting debate: {topic}")
        emit("start", topic=topic)
        
        # Create agents
        leftist = DebateAgent(
            name="Leftist Agent",
            role="leftist",
            perspectives=leftist_perspectives,
            api_key=self.api_key
        )
        
        rightist = DebateAgent(
            name="Rightist Agent",
            role="rightist",
            perspectives=rightist_perspectives,
            api_key=self.api_key
        )
        
        common = DebateAgent(
            name="Common Agent",
            role="common/neutral",
            perspectives=common_perspectives,
            api_key=self.api_key
        )
        
        judge = JudgeAgent(api_key=self.api_key)
        
        debate_transcript = []
        
        # Round 1: Initial arguments
        emit("round_start", round=1)
        print("Round 1: Initial arguments")
        
        leftist_arg = leftist.make_argument(topic)
        debate_transcript.append({"agent": "Leftist Agent", "argument": leftist_arg, "round": 1})
        emit(
            "agent_argument",
            agent="Leftist Agent",
            agent_type="leftist",
            argument=leftist_arg,
            round=1,
        )
        
        rightist_arg = rightist.make_argument(topic)
        debate_transcript.append({"agent": "Rightist Agent", "argument": rightist_arg, "round": 1})
        emit(
            "agent_argument",
            agent="Rightist Agent",
            agent_type="rightist",
            argument=rightist_arg,
            round=1,
        )
        
        common_arg = common.make_argument(topic)
        debate_transcript.append({"agent": "Common Agent", "argument": common_arg, "round": 1})
        emit(
            "agent_argument",
            agent="Common Agent",
            agent_type="common",
            argument=common_arg,
            round=1,
        )
        
        # Additional rounds
        current_round = 2
        while current_round <= max_rounds:
            if current_round > min_rounds:
                # Check if should continue
                recent_args = "\n\n".join([
                    f"{t['agent']}: {t['argument']}" 
                    for t in debate_transcript[-4:]
                ])
                
                try:
                    response = judge.model.generate_content(
                        f"Has this debate reached conclusion? YES or NO:\n{recent_args}",
                        generation_config={'temperature': 0.3, 'max_output_tokens': 10}
                    )
                    if "YES" in response.text.upper():
                        print(f"Judge determined debate can conclude after round {current_round - 1}")
                        break
                except:
                    pass
            
            emit("round_start", round=current_round)
            print(f"Round {current_round}: Responses")
            
            debate_history = "\n\n".join([
                f"[{t['agent']}]: {t['argument']}" 
                for t in debate_transcript
            ])
            
            # Agents respond
            leftist_response = leftist.respond_to_opponent(topic, rightist_arg, debate_history)
            debate_transcript.append({"agent": "Leftist Agent", "argument": leftist_response, "round": current_round})
            emit(
                "agent_argument",
                agent="Leftist Agent",
                agent_type="leftist",
                argument=leftist_response,
                round=current_round,
            )
            
            rightist_response = rightist.respond_to_opponent(topic, leftist_arg, debate_history)
            debate_transcript.append({"agent": "Rightist Agent", "argument": rightist_response, "round": current_round})
            emit(
                "agent_argument",
                agent="Rightist Agent",
                agent_type="rightist",
                argument=rightist_response,
                round=current_round,
            )
            
            common_response = common.respond_to_opponent(topic, leftist_arg, debate_history)
            debate_transcript.append({"agent": "Common Agent", "argument": common_response, "round": current_round})
            emit(
                "agent_argument",
                agent="Common Agent",
                agent_type="common",
                argument=common_response,
                round=current_round,
            )
            
            current_round += 1
        
        # Judge evaluation
        print("Judge evaluating debate...")
        transcript_text = "\n\n".join([f"[{t['agent']}]: {t['argument']}" for t in debate_transcript])
        
        judgment = judge.evaluate_debate(topic, transcript_text)
        emit(
            "finalizing",
            trust_score=judgment.get("trust_score"),
            total_rounds=current_round - 1,
        )
        
        result = {
            "topic": topic,
            "trust_score": judgment["trust_score"],
            "judgment": judgment["full_judgment"],
            "debate_transcript": debate_transcript,
            "total_rounds": current_round - 1
        }
        
        print(f"Debate completed: Trust score = {judgment['trust_score']}%")
        emit("complete", trust_score=judgment.get("trust_score"), total_rounds=current_round - 1)
        
        return result
