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
        
        knowledge_text.append("YOUR PERSPECTIVE ANGLES:")
        for idx, item in enumerate(perspectives, 1):
            knowledge_text.append(f"\n[Viewpoint {idx}]")
            knowledge_text.append(f"Angle: {item.get('text', '')}")
            knowledge_text.append(f"Bias score: {item.get('bias_x', 0)} (your ideological leaning on this topic)")
            knowledge_text.append("")
        
        knowledge_text.append("\nAVAILABLE EVIDENCE (cite these in your arguments):")
        evidence_count = 0
        for idx, item in enumerate(perspectives, 1):
            relevant_links = item.get('relevant_links', [])
            if relevant_links:
                for link_idx, link in enumerate(relevant_links, 1):
                    evidence_count += 1
                    knowledge_text.append(f"\n[Evidence {evidence_count}]")
                    knowledge_text.append(f"Title: {link.get('title', '')}")
                    knowledge_text.append(f"URL: {link.get('link', '')}")
                    knowledge_text.append(f"Source Type: {link.get('source_type', 'Unknown')}")
                    knowledge_text.append(f"Trust Score: {link.get('trust_score', 0.5)}/1.0")
                    if link.get('snippet'):
                        knowledge_text.append(f"Summary: {link['snippet'][:200]}")
                    if link.get('extracted_content'):
                        content_preview = link['extracted_content'][:400].replace('\n', ' ')
                        knowledge_text.append(f"Content excerpt: {content_preview}...")
                    knowledge_text.append("")
        
        if evidence_count == 0:
            knowledge_text.append("\n(No evidence available - argue based on perspectives only)")
        
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
    
    def make_argument(self, topic: str, debate_context: str = "", round_num: int = 1) -> str:
        if round_num == 1:
            stage = "OPENING STATEMENT"
            instructions = """This is your opening statement. Introduce your position clearly.

What to do:
- State whether you find the claim trustworthy, questionable, or false
- Give 2-3 reasons why (brief overview)
- Mention the type of evidence you'll present later

Speak naturally like a real debater. Keep it concise (100-150 words).
DO NOT cite specific sources yet - save that for evidence rounds."""
        
        elif round_num in [2, 3]:
            stage = "EVIDENCE PRESENTATION"
            instructions = """Now present your evidence. This is where you back up your position with facts.

For EACH piece of evidence you cite:
- Name the source and its trust score
- Quote or summarize what it says
- Explain why this matters for your argument

Present 2-3 strong pieces of evidence from your available evidence list.
Speak like you're presenting facts to a jury (150-200 words).
Cite sources properly: "According to [Source], which has a trust score of X.X..."."""
        
        elif round_num in [4, 5]:
            stage = "CROSS-EXAMINATION"
            instructions = """Time to challenge your opponent and defend your position.

Attack their case:
- Point out weak sources (low trust scores, questionable origins)
- Show contradicting evidence from YOUR sources
- Highlight logical flaws or speculation in their reasoning

Present counter-evidence if you have it.
Be assertive but factual. This is cross-examination (150-200 words)."""
        
        else:
            stage = "CLOSING ARGUMENT"
            instructions = """Final chance to make your case. Summarize and convince.

Structure:
1. Your strongest piece of evidence (cite it again)
2. Why opponent's case is weaker
3. What remains unclear or disputed
4. Your final verdict with confidence level (High/Medium/Low certainty)

Make it compelling and clear (150-200 words)."""
        
        prompt = f"""You are {self.name}, a debater representing the {self.role} viewpoint.

DEBATE STAGE: {stage} (Round {round_num})
TOPIC: {topic}

{self.knowledge}

{debate_context}

{instructions}

Speak naturally like a real debater. DO NOT just list perspectives - use them as your lens to interpret evidence.
Your argument:"""

        try:
            response = self.model.generate_content(
                prompt,
                generation_config={'temperature': 0.6, 'max_output_tokens': 400}
            )
            return response.text.strip()
        except Exception as e:
            return f"Error generating argument: {str(e)}"
    
    def respond_to_opponent(self, topic: str, opponent_argument: str, debate_history: str, round_num: int = 2) -> str:
        if round_num in [2, 3]:
            stage = "EVIDENCE PRESENTATION"
            instructions = """Now present your evidence. Back up your position with facts.

For EACH piece of evidence:
- Name the source and trust score
- Quote or summarize key findings
- Explain relevance to your argument

Present 2-3 strong pieces of evidence from your available evidence list.
Cite sources properly: "According to [Source], which has a trust score of X.X..."
Speak like you're presenting to a jury (150-200 words)."""
        
        elif round_num in [4, 5]:
            stage = "CROSS-EXAMINATION"
            instructions = """Respond to your opponent's arguments. Challenge and counter.

OPPONENT SAID:
{opponent_argument}

Your response should:
- Point out flaws in their sources (trust scores, bias, credibility issues)
- Present contradicting evidence from YOUR evidence list
- Expose logical gaps or unfounded assumptions
- Distinguish confirmed facts from speculation

Be assertive and factual (150-200 words)."""
        
        else:
            stage = "CLOSING ARGUMENT"
            instructions = """Final argument. Make your case one last time.

OPPONENT'S POSITION:
{opponent_argument}

Your closing:
1. Your strongest evidence (cite it)
2. Why opponent's case fails
3. What's still uncertain
4. Final verdict (High/Medium/Low confidence)

Be compelling and clear (150-200 words)."""
        
        prompt = f"""You are {self.name}, a debater representing the {self.role} viewpoint.

DEBATE STAGE: {stage} (Round {round_num})
TOPIC: {topic}

{self.knowledge}

DEBATE SO FAR:
{debate_history[-1000:]}

{instructions}

Speak naturally like a real debater. Use evidence to support your viewpoint.
DO NOT just repeat perspectives - interpret evidence through your lens.
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
        prompt = f"""You are an impartial JUDGE. Your job is to EDUCATE and CLARIFY truth for the user.

TOPIC: {topic}

FULL DEBATE TRANSCRIPT:
{debate_transcript}

Provide a comprehensive evaluation that helps the user understand what's true, what's uncertain, and how to verify.

Use this EXACT structure with clean formatting (no asterisks or markdown):

FINAL JUDGMENT

1. CONFIRMED FACTS (What We Know For Certain)
List facts verified by multiple credible sources with citations.
Format each fact as:
- [Fact statement] (Source: Title, Trust: X.XX)

2. DISPUTED OR UNCLEAR (Areas of Disagreement)
What's being debated and WHY people disagree.
Explain conflicting interpretations and missing context.
Use bullet points starting with -

3. MOST LIKELY EXPLANATION (Assessment)
Your best judgment based on evidence presented.
State confidence level: High Confidence / Medium Confidence / Low Confidence
Explain key reasoning in 2-3 sentences.

4. RED FLAGS (Warning Signs)
Signs of manipulation, bias, or missing critical context.
Note emotional language vs factual claims.
Identify speculation presented as fact.
Use bullet points starting with -

5. HOW TO VERIFY (Next Steps)
What additional sources to check.
Specific questions to investigate.
How to spot similar situations.
Use bullet points starting with -

TRUST SCORE: [0-100]%
Based on evidence quality, source credibility, and areas of agreement.

Write naturally and clearly. Use bullet points with - not asterisks.
NO markdown formatting like bold or italics.
Be educational, not preachy. Acknowledge uncertainty where it exists.

Your judgment:"""

        try:
            response = self.model.generate_content(
                prompt,
                generation_config={'temperature': 0.4, 'max_output_tokens': 800}
            )
            
            text = response.text.strip()
            
            # Clean up any remaining markdown artifacts
            text = text.replace('**', '')
            text = text.replace('##', '')
            
            trust_score = 50
            if "TRUST SCORE:" in text:
                score_line = text.split("TRUST SCORE:")[1].split("\n")[0].strip()
                import re
                numbers = re.findall(r'\d+', score_line)
                if numbers:
                    trust_score = int(numbers[0])
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
        max_rounds: int = 7,
        min_rounds: int = 6,
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
        
        # Round 1: Opening statements
        emit("round_start", round=1)
        print("Round 1: Opening Statements")
        
        leftist_arg = leftist.make_argument(topic, round_num=1)
        debate_transcript.append({"agent": "Leftist Agent", "argument": leftist_arg, "round": 1})
        emit(
            "agent_argument",
            agent="Leftist Agent",
            agent_type="leftist",
            argument=leftist_arg,
            round=1,
        )
        
        rightist_arg = rightist.make_argument(topic, round_num=1)
        debate_transcript.append({"agent": "Rightist Agent", "argument": rightist_arg, "round": 1})
        emit(
            "agent_argument",
            agent="Rightist Agent",
            agent_type="rightist",
            argument=rightist_arg,
            round=1,
        )
        
        common_arg = common.make_argument(topic, round_num=1)
        debate_transcript.append({"agent": "Common Agent", "argument": common_arg, "round": 1})
        emit(
            "agent_argument",
            agent="Common Agent",
            agent_type="common",
            argument=common_arg,
            round=1,
        )
        
        # Additional rounds with stage-based prompts
        current_round = 2
        while current_round <= max_rounds:
            if current_round > min_rounds:
                # Check if should continue (only after minimum rounds)
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
            
            # Determine stage name for logging
            if current_round in [2, 3]:
                stage_name = "Evidence Presentation"
            elif current_round in [4, 5]:
                stage_name = "Cross-Examination"
            else:
                stage_name = "Closing Arguments"
            
            emit("round_start", round=current_round)
            print(f"Round {current_round}: {stage_name}")
            
            debate_history = "\n\n".join([
                f"[{t['agent']}]: {t['argument']}" 
                for t in debate_transcript
            ])
            
            # Agents respond with round-specific prompts
            leftist_response = leftist.respond_to_opponent(topic, rightist_arg, debate_history, round_num=current_round)
            debate_transcript.append({"agent": "Leftist Agent", "argument": leftist_response, "round": current_round})
            emit(
                "agent_argument",
                agent="Leftist Agent",
                agent_type="leftist",
                argument=leftist_response,
                round=current_round,
            )
            
            rightist_response = rightist.respond_to_opponent(topic, leftist_arg, debate_history, round_num=current_round)
            debate_transcript.append({"agent": "Rightist Agent", "argument": rightist_response, "round": current_round})
            emit(
                "agent_argument",
                agent="Rightist Agent",
                agent_type="rightist",
                argument=rightist_response,
                round=current_round,
            )
            
            common_response = common.respond_to_opponent(topic, leftist_arg, debate_history, round_num=current_round)
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
