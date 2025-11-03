# Module 4: Agent Debate & Analysis

AI agent debate system that analyzes information trustworthiness through structured debate.

## Overview

Module 4 receives perspective data from Module 3 and conducts a debate between two AI agents (Leftist and Rightist) to determine the trustworthiness of information. A Judge AI then provides a final trust score.

## Requirements

### Required
- Python 3.8+
- Google Gemini API key (gemini-2.0-flash model)

### Dependencies
```bash
pip install -r requirements.txt
```

**Note:** Selenium is NOT required for basic Module 4 operation. It's only needed if you want to use the RelevanceSearchSystem from the reference backend (which Module 3 already handles).

## Configuration

### 1. API Key Setup

**Option A: Environment Variable (Recommended)**
```bash
set GOOGLE_API_KEY=your_api_key_here
```

**Option B: Config File**
Edit `config.json`:
```json
{
  "api_key": "your_google_gemini_api_key_here"
}
```

### 2. Get Google Gemini API Key
1. Go to https://makersuite.google.com/app/apikey
2. Create a new API key
3. Copy and use it in one of the methods above

### 3. Web Enrichment Setup (Optional)

For web scraping and enrichment features, add to `config.json`:

```json
{
  "api_key": "your_google_gemini_api_key",
  "search_engine_id": "your_custom_search_engine_id",
  "links_per_text": 3,
  "rate_limiting": {
    "delay_between_requests": 2,
    "max_retries": 3
  },
  "gemini_settings": {
    "model": "gemini-2.0-flash",
    "relevance_threshold": 0.7,
    "requests_per_minute": 10
  },
  "search_settings": {
    "safe": "active",
    "language": "en",
    "country": "us"
  }
}
```

**Get Google Custom Search Engine ID:**
1. Go to https://programmablesearchengine.google.com/
2. Create a new search engine
3. Enable "Search the entire web"
4. Copy the Search Engine ID

## Usage

### Standalone
```bash
cd module4/backend
python main.py
```

Server runs on: http://127.0.0.1:8004

### With Full System
Use the start-all.bat script from project root:
```bash
start-all.bat
```

Or start Module 4 separately:
```bash
start-module4.bat
```

## API Endpoints

### POST /upload-perspectives
Upload perspective data from Module 3
```json
{
  "leftist": [...],
  "rightist": [...],
  "common": [...],
  "input": {...}
}
```

### POST /api/enrich-perspectives (NEW)
Enrich simple perspective data with web-scraped content.
Converts leftist.json, rightist.json, common.json → relevant_leftist.json, relevant_rightist.json, relevant_common.json

Features:
- Google Custom Search API integration
- Gemini AI relevance checking
- Source trust scoring
- Selenium web content extraction

Returns: Summary of enrichment process with total relevant links found

**Note:** Requires Google Custom Search Engine ID and API key. See Configuration section below.

### POST /api/debate
Start the AI agent debate.
Automatically uses enriched data (relevant_*.json) if available, otherwise falls back to simple perspective files.
Returns debate transcript and trust score

### GET /api/debate/result
Get the latest debate result

### GET /api/health
Health check endpoint

### GET /api/status
Get system status and file availability

## How It Works

1. **Data Reception**: Receives perspective data from Module 3 via `/upload-perspectives`
2. **Agent Initialization**: Creates two AI agents with different perspective sets
3. **Debate Rounds**: Agents debate for 1-3 rounds (dynamically determined)
4. **Judge Evaluation**: Judge AI analyzes the debate and assigns a trust score (0-100%)
5. **Result Output**: Returns complete debate transcript and final judgment

## Data Flow

### Standard Flow (Simple Perspectives)
```
Module 3 → /upload-perspectives → Save to data/*.json
                                       ↓
Frontend → /api/debate → DebateOrchestrator → AI Agents Debate
                                                      ↓
                                                Judge AI Evaluation
                                                      ↓
                                            Trust Score & Judgment
                                                      ↓
                                                   Frontend
```

### Enriched Flow (With Web Scraping)
```
Module 3 → /upload-perspectives → Save to data/*.json
                                       ↓
Frontend → /api/enrich-perspectives → RelevanceSearchSystem
                                          ↓
                                    Google Custom Search
                                          ↓
                                    Gemini Relevance Check
                                          ↓
                                    Gemini Trust Scoring
                                          ↓
                                    Selenium Web Scraping
                                          ↓
                                    Save to data/relevant_*.json
                                          ↓
Frontend → /api/debate → DebateOrchestrator (uses enriched data)
                                 ↓
                           AI Agents Debate with Evidence
                                 ↓
                           Judge AI Evaluation
                                 ↓
                           Trust Score & Judgment
                                 ↓
                              Frontend
```

## File Structure

```
module4/
├── backend/
│   ├── main.py               # FastAPI server with API endpoints
│   ├── debate.py             # Debate orchestrator and AI agents
│   ├── relevance_search.py   # Web scraping and enrichment system
│   ├── config.json           # API key and search configuration
│   ├── requirements.txt  # Python dependencies
│   ├── data/            # Perspective data directory
│   │   ├── leftist.json
│   │   ├── rightist.json
│   │   ├── common.json
│   │   └── input.json
│   └── debate_result.json  # Latest debate result
```

## Troubleshooting

### "Google API key not found"
- Set GOOGLE_API_KEY environment variable, OR
- Add api_key to config.json

### "Required files not found"
- Make sure Module 3 has completed processing
- Check that data/*.json files exist
- Try calling /upload-perspectives endpoint manually

### "Debate orchestrator not available"
- Ensure google-generativeai package is installed
- Check API key is valid
- Verify internet connection

## Integration with Other Modules

- **Module 3**: Sends perspective data via `/upload-perspectives`
- **Frontend**: Triggers debate via `/api/debate` and displays results
- **Orchestrator**: Routes requests to Module 4 at port 8004

## Notes

- The debate dynamically adjusts rounds based on depth of discussion
- Trust scores range from 0-100%, with detailed reasoning
- All debate data is saved to debate_result.json
- Perspective data must be uploaded before starting a debate
