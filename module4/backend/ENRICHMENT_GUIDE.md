# Module 4 Enrichment Workflow

This document explains how to convert simple perspective data from Module 3 into enriched data with web-scraped evidence.

## Overview

The enrichment process takes simple perspective files (leftist.json, rightist.json, common.json) and adds:
- Relevant web links from Google Custom Search
- Trust scores for each source
- Extracted web content from URLs
- Relevance confidence scores

## Prerequisites

1. **Google Gemini API Key**: Already configured for Module 4
2. **Google Custom Search Engine ID**: Required for web searching
   - Create at: https://programmablesearchengine.google.com/
   - Enable "Search the entire web"
   - Copy the Search Engine ID

3. **ChromeDriver**: Required for Selenium web scraping
   - Install: `pip install webdriver-manager`
   - Or download manually from https://chromedriver.chromium.org/

## Configuration

Update `module4/backend/config.json`:

```json
{
  "api_key": "your_gemini_api_key",
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

## API Usage

### Step 1: Upload Perspective Data
```bash
POST http://localhost:8004/upload-perspectives
Content-Type: application/json

{
  "leftist": [...],
  "rightist": [...],
  "common": [...],
  "input": {...}
}
```

### Step 2: Enrich Perspectives with Web Content
```bash
POST http://localhost:8004/api/enrich-perspectives
```

This will:
1. Load leftist.json, rightist.json, common.json from data/
2. For each perspective text:
   - Rephrase with topic context using Gemini
   - Search Google Custom Search API
   - Check relevance using Gemini AI
   - Score trust level using Gemini AI
   - Extract web content using Selenium
3. Save enriched files: data/relevant_leftist.json, data/relevant_rightist.json, data/relevant_common.json

Response:
```json
{
  "status": "completed",
  "message": "Perspectives enriched successfully with web content",
  "files_created": [
    "relevant_leftist.json",
    "relevant_rightist.json",
    "relevant_common.json"
  ],
  "total_relevant_links": 42,
  "summary": {
    "leftist.json": {
      "total_items": 9,
      "items_with_links": 7
    },
    ...
  }
}
```

### Step 3: Start Debate with Enriched Data
```bash
POST http://localhost:8004/api/debate
```

The debate will automatically use enriched files if available, otherwise falls back to simple perspective files.

## Data Format Comparison

### Simple Format (from Module 3)
```json
[
  {
    "color": "red",
    "bias_x": 0.0,
    "significance_y": 0.8,
    "text": "Statement about the topic..."
  }
]
```

### Enriched Format (after enrichment)
```json
{
  "topic": "Topic name",
  "source_file": "leftist.json",
  "processed_at": "2025-11-03T12:00:00",
  "total_items": 9,
  "items": [
    {
      "text": "Statement about the topic...",
      "bias_x": 0.0,
      "significance_y": 0.8,
      "combined_score": 0.0,
      "color": "red",
      "relevant_links": [
        {
          "title": "News Article Title",
          "link": "https://example.com/article",
          "snippet": "Article snippet from search results...",
          "trust_score": 0.75,
          "source_type": "News organization",
          "extracted_content": "Full text content extracted from the webpage..."
        }
      ]
    }
  ]
}
```

## Frontend Integration

Update the Module 4 frontend component to call enrichment before debate:

```typescript
async function startDebateWithEnrichment() {
  try {
    // Step 1: Send perspectives from Module 3
    await fetch('/module3/api/send_to_module4', { method: 'POST' });
    
    // Step 2: Enrich with web content
    const enrichResponse = await fetch('/module4/api/enrich-perspectives', { 
      method: 'POST' 
    });
    const enrichResult = await enrichResponse.json();
    console.log(`Enriched with ${enrichResult.total_relevant_links} relevant links`);
    
    // Step 3: Start debate
    const debateResponse = await fetch('/module4/api/debate', { 
      method: 'POST' 
    });
    const debateResult = await debateResponse.json();
    
    // Display results
    displayDebateResults(debateResult);
  } catch (error) {
    console.error('Debate process failed:', error);
  }
}
```

## Performance Considerations

### Rate Limiting
- Google Gemini API: 10 requests/minute (configurable)
- Google Custom Search: 100 queries/day (free tier)
- Delays between requests: 2 seconds (configurable)

### Processing Time
For a typical dataset:
- 9 leftist perspectives
- 9 rightist perspectives  
- 9 common perspectives
- 3 links per perspective
- Total: ~81 search queries + relevance checks + trust scoring + web scraping
- Estimated time: 10-15 minutes

### Optimization Tips
1. Reduce `links_per_text` from 3 to 2
2. Increase `relevance_threshold` from 0.7 to 0.8 (fewer links pass)
3. Process files sequentially to avoid API rate limits
4. Cache enriched results to avoid re-processing

## Troubleshooting

### "Search engine ID not found"
- Make sure `search_engine_id` is in config.json
- Or set environment variable: `SEARCH_ENGINE_ID=your_id_here`

### "Selenium WebDriver not available"
- Install: `pip install selenium webdriver-manager`
- Ensure Chrome browser is installed
- The system will still work without Selenium, but won't extract web content

### "Rate limit exceeded"
- Google Gemini API has rate limits
- Adjust `requests_per_minute` in config.json
- Add delays between processing files

### "No relevant links found"
- Lower `relevance_threshold` from 0.7 to 0.5
- Check if search queries are too specific
- Verify Google Custom Search Engine is configured correctly

## Standalone Usage

You can also run the enrichment system standalone:

```bash
cd module4/backend
python relevance_search.py
```

This will process all files in the data/ directory and create enriched versions.

## Next Steps

After enrichment, the debate agents will have access to:
- Source URLs and titles
- Trust scores for each source
- Extracted web content
- Source type (News, Academic, Government, etc.)

This allows agents to make more evidence-based arguments with specific citations and credibility assessments.
