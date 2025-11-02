# Module 2: Information Classification & Significance Scoring

## Overview

Module 2 receives output from Module 1 and performs intelligent classification and significance scoring using Google Gemini AI. The significance score has an **inverse relationship with confidence** - the less obvious the scam, the higher the significance score for debate.

## Key Features

### 1. Information Classification
Uses AI to classify information into verification categories:
- **Person**: Requires verification through personal sources
- **Organization**: Requires verification through institutional sources
- **Social**: Requires verification through social/community sources
- **Critical**: Requires verification through emergency/security authorities
- **STEM**: Can be verified immediately using established facts

### 2. Significance Score (0-100)
**Inverse Confidence Relationship:**
- **95-100% confidence → 10-20 score**: Obvious threat, minimal debate needed
- **80-94% confidence → 30-50 score**: Likely threat, moderate debate
- **60-79% confidence → 60-75 score**: Suspicious, high debate significance
- **40-59% confidence → 80-90 score**: Ambiguous, critical debate needed
- **0-39% confidence → 5-15 score**: Low threat, minimal significance

### 3. Comprehensive Summary
AI-generated explanation capturing all information in clear, readable format.

## Data Flow

```
Module 1 (output.json) → Module 2 (process) → Module 2 (output.json)
                                              → Module 3 (input.json)
```

### Input (from Module 1)
Reads: `module1/backend/output.json` and `module1/backend/input.json`

### Output
1. **Detailed Output** (`module2/backend/output.json`):
   - Full classification with reasoning
   - Significance score + explanation
   - Comprehensive summary
   - Debate requirement flag
   - Debate priority level
   - Module 1 metadata

2. **Simplified Output** (`module3/backend/input.json`):
   - Classification percentages
   - Significance score
   - Original text
   - Timestamp

## API Endpoints

### `POST /api/process`
Process Module 1's output and generate classification.

**Response:**
```json
{
  "detailed_analysis": {
    "classification": {
      "person": 20.0,
      "organization": 30.0,
      "social": 15.0,
      "critical": 25.0,
      "stem": 10.0
    },
    "classification_reasoning": "AI reasoning for classification",
    "classification_confidence": 95.0,
    "significance_score": 65,
    "significance_explanation": "Significance calculation explanation",
    "comprehensive_summary": "Clear summary of the information",
    "requires_debate": true,
    "debate_priority": "high"
  },
  "module1_confidence": 0.75,
  "module1_risk_level": "dangerous",
  "module1_threats": ["financial_scam", "phishing_potential"],
  "timestamp": "2025-11-02T..."
}
```

### `GET /api/input`
Get Module 1's output (Module 2's input).

### `GET /api/output`
Get Module 2's output.

### `GET /api/health`
Health check endpoint.

## Configuration

### Environment Variables (Root .env)
```properties
GEMINI_API_KEY=your_api_key_here
MODEL_NAME=gemini-2.5-flash
MODULE2_PORT=8002
```

### Port Configuration
- **Default Port**: 8002
- **Orchestrator**: Proxies requests to `/module2/*`
- **CORS**: Allows localhost:3001, localhost:3000

## Significance Score Algorithm

```python
def calculate_significance_score(confidence, risk_level, threats):
    # Inverse relationship: low confidence = high significance
    if confidence >= 0.95 and risk_level == "dangerous":
        score = 10-20  # Obvious, skip to final
    elif confidence >= 0.80:
        score = 30-50  # Moderate debate
    elif confidence >= 0.60:
        score = 60-75  # High debate significance
    elif confidence >= 0.40:
        score = 80-90  # Critical debate needed
    else:
        score = 5-15   # Low significance
    
    # Boost if multiple threats
    if len(threats) >= 3:
        score += 10
    
    return score
```

## Debate Priority Levels

- **Critical (80-100)**: Urgent debate needed, highly ambiguous
- **High (60-79)**: Significant debate required
- **Medium (30-59)**: Moderate analysis needed
- **Low (0-29)**: Minimal debate, likely clear-cut

## Running Module 2

### Startup
```bash
# Windows
start-module2.bat

# Or directly
cd module2/backend
python main.py
```

### Dependencies
```bash
pip install -r requirements.txt
```

Required packages:
- `google-generativeai>=0.3.0`
- `fastapi>=0.68.0`
- `uvicorn>=0.15.0`
- `python-dotenv>=0.19.0`
- `pydantic>=1.8.0`

## Testing

### Manual Test Flow
1. Run Module 1 analysis first
2. Start Module 2: `start-module2.bat`
3. Trigger processing: `POST http://localhost:8002/api/process`
4. View results: `GET http://localhost:8002/api/output`
5. Check Module 3 input: View `module3/backend/input.json`

### Test Cases

**High Confidence (95%)** → Low Significance (15):
```
Input: "Click here to earn $1000 every day!"
Expected: Obvious scam, minimal debate needed
```

**Medium Confidence (65%)** → High Significance (70):
```
Input: "This investment opportunity offers great returns"
Expected: Ambiguous, significant debate needed
```

**Low Confidence (45%)** → Very High Significance (85):
```
Input: "New product launch announcement"
Expected: Unclear threat level, critical debate needed
```

## Module Architecture

```
module2/
├── backend/
│   ├── main.py                 # FastAPI server + endpoints
│   ├── output.json            # Detailed analysis output
│   └── Modules/
│       ├── Classifier/
│       │   └── classifier.py  # AI classification logic
│       ├── SignificanceScore/
│       │   └── scoreProvider.py  # Triage scoring (backup)
│       └── Summarizer/
│           └── summarizer.py  # AI summarization
├── requirements.txt
└── README.md
```

## Integration Notes

### With Module 1
- Reads `module1/backend/output.json` for analysis metadata
- Reads `module1/backend/input.json` for original text
- Uses Module 1's confidence score for significance calculation

### With Module 3
- Writes `module3/backend/input.json` with simplified classification
- Significance score determines debate depth in Module 3
- Higher significance = more perspectives generated

## Error Handling

- **404**: Module 1 output not found (run Module 1 first)
- **500**: AI processing failed (check API key, model availability)
- **503**: Service unavailable (check orchestrator registration)

## AI Models Used

1. **Classifier**: `gemini-2.5-flash`
   - Analyzes text for verification requirements
   - Returns category percentages + reasoning

2. **Summarizer**: `gemini-2.5-flash`
   - Generates comprehensive summary
   - Preserves all information in readable format

## Production Considerations

- API key loaded from root `.env` (centralized)
- Model name configurable via environment
- Port conflicts avoided (8002 vs Module 1's 8001)
- CORS configured for frontend access
- File paths use absolute references for reliability
- Error logging for debugging

## Next Steps

- Connect to frontend (Module 2 page)
- Display classification visualization
- Show significance score with explanation
- Display comprehensive summary
- Indicate debate requirement
