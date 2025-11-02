# Module 1 Data Persistence

## Overview
Module 1 now saves all analysis results to JSON files that Module 2 can access.

## Files Created
- `module1/backend/input.json` - Stores the last input data
- `module1/backend/output.json` - Stores the last analysis result

## Data Structure

### Input Data (Text Analysis)
```json
{
  "type": "text",
  "text": "User's input text",
  "timestamp": "2025-11-02T12:34:56.123456"
}
```

### Input Data (URL Analysis)
```json
{
  "type": "url",
  "url": "https://example.com",
  "timestamp": "2025-11-02T12:34:56.123456"
}
```

### Input Data (Image Analysis)
```json
{
  "type": "image",
  "image_source": "url" | "base64",
  "context_text": "Optional context",
  "url": "Optional URL",
  "image_format": "JPEG",
  "image_size_kb": 245.6,
  "timestamp": "2025-11-02T12:34:56.123456"
}
```

### Output Data
```json
{
  "input_type": "text" | "url" | "image",
  "risk_level": "safe" | "suspicious" | "dangerous",
  "confidence": 0.95,
  "threats": ["phishing", "scam_language"],
  "recommendation": "Human-readable recommendation",
  "ai_powered": true,
  "analysis_details": {},
  "timestamp": "2025-11-02T12:34:56.123456",
  
  // For URL analysis:
  "scraped_title": "Page title",
  "scraped_text": "Full page content",
  
  // For image analysis:
  "visual_elements": ["fake_qr_code", "manipulated_image"],
  "extracted_text": "Text extracted via OCR",
  "ai_reasoning": "Detailed AI analysis",
  "image_info": {
    "format": "JPEG",
    "size_kb": 245.6,
    "dimensions": [1920, 1080],
    "source": "upload" | "url"
  }
}
```

## New API Endpoints

### GET /api/input
Returns the last input data saved by Module 1.

**Response:**
- 200: JSON with input data
- 404: No data available yet
- 500: Error reading file

### GET /api/output
Returns the last analysis result from Module 1.

**Response:**
- 200: JSON with output data
- 404: No data available yet
- 500: Error reading file

### GET /api/status (Updated)
Now includes data availability info:
```json
{
  "status": "ready",
  "service": "module1",
  "endpoints": [...],
  "features": {
    "data_persistence": true
  },
  "data_available": {
    "input": true,
    "output": true
  }
}
```

## Module 2 Integration

Module 2 can now access Module 1's data:

```python
import httpx

# Get input data
response = await client.get("http://orchestrator:8000/module1/api/input")
input_data = response.json()

# Get output data
response = await client.get("http://orchestrator:8000/module1/api/output")
output_data = response.json()

# Use the data for further processing
risk_level = output_data["risk_level"]
threats = output_data["threats"]
```

## How It Works

1. **User submits analysis** via `/api/analyze` or `/api/analyze-image`
2. **Module 1 processes** the request (text/URL/image)
3. **Generates analysis** using Gemini AI
4. **Saves to JSON files**:
   - `input.json` - What the user submitted
   - `output.json` - The analysis result
5. **Returns result** to user
6. **Module 2 can read** the saved files via `/api/input` and `/api/output`

## Benefits

✅ **Module Communication** - Module 2 can access Module 1's results
✅ **Data Persistence** - Last analysis is always available
✅ **Simple Integration** - Standard HTTP GET requests
✅ **Debugging** - Easy to inspect saved data
✅ **Pipeline Ready** - Supports multi-module workflows

## Testing

```bash
# Analyze something (text, URL, or image)
curl -X POST http://localhost:8001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "Test scam message"}'

# Check saved input
curl http://localhost:8001/api/input

# Check saved output
curl http://localhost:8001/api/output

# Verify data availability
curl http://localhost:8001/api/status
```

## Next Steps

- Restart Module 1 to load the new code
- Test with text/URL/image analysis
- Verify JSON files are created
- Module 2 can now read these files for further processing
