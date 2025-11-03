# Module 4 Backend - Required Endpoint

## Current Status
Your friend has deployed Module 4 backend at:
`https://idk-backend-382118575811.asia-south1.run.app`

## Missing Endpoint

The deployed backend is missing the `/upload-perspectives` endpoint that Module 3 needs to send perspective data.

## What Your Friend Needs to Add

Add this endpoint to the deployed Module 4 backend server code:

```python
from pydantic import BaseModel
from typing import List, Dict, Any
import json
import os

# Add this model near the top with other models
class PerspectiveData(BaseModel):
    leftist: List[Dict[str, Any]]
    rightist: List[Dict[str, Any]]
    common: List[Dict[str, Any]]

# Add this endpoint
@app.post("/upload-perspectives")
async def upload_perspectives(data: PerspectiveData):
    """Receive perspective data from Module 3 and save to data directory"""
    try:
        # Ensure data directory exists
        os.makedirs("data", exist_ok=True)
        
        # Save each perspective category to its own file
        with open("data/leftist.json", "w", encoding="utf-8") as f:
            json.dump(data.leftist, f, indent=2, ensure_ascii=False)
        
        with open("data/rightist.json", "w", encoding="utf-8") as f:
            json.dump(data.rightist, f, indent=2, ensure_ascii=False)
        
        with open("data/common.json", "w", encoding="utf-8") as f:
            json.dump(data.common, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Received and saved perspective data: {len(data.leftist)} leftist, {len(data.rightist)} rightist, {len(data.common)} common")
        
        return {
            "status": "success",
            "message": "Perspective data uploaded successfully",
            "counts": {
                "leftist": len(data.leftist),
                "rightist": len(data.rightist),
                "common": len(data.common)
            }
        }
    except Exception as e:
        logger.error(f"Failed to save perspective data: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save perspective data: {str(e)}")
```

## After Adding the Endpoint

Once your friend adds this endpoint and redeploys:

1. Module 3 will send perspective data via `/api/send_to_module4`
2. Module 4 will receive the data at `/upload-perspectives` and save to files
3. Module 4's `/debate` endpoint will use those files to run the debate
4. Frontend will display the debate results

## Current Frontend Flow

The frontend Module 4 component now does:
1. User clicks "Start Debate"
2. Frontend calls `/module3/api/send_to_module4` (via orchestrator proxy)
3. Module 3 backend POSTs perspective data to Module 4's `/upload-perspectives`
4. Frontend then calls Module 4's `/debate` endpoint
5. Module 4 runs the debate and returns results
6. Frontend displays the debate transcript and trust score

## Testing

After deployment, test with:
```bash
curl -X POST https://idk-backend-382118575811.asia-south1.run.app/upload-perspectives \
  -H "Content-Type: application/json" \
  -d '{"leftist":[],"rightist":[],"common":[]}'
```

Should return: `{"status":"success",...}`
