# Module 4 Integration - Backend URL Configuration

## ✅ COMPLETED CHANGES

### Your Module 4 Server Configuration:
- **File:** `module4-server.py`
- **Updated DUMMY_SERVER_URL to:** `https://idk-backend-382118575811.asia-south1.run.app`
- ✅ Module 4 now points to your friend's backend
- ✅ frontend-reference folder removed

---

## 📡 URL FOR YOUR FRIEND'S BACKEND

**Your friend needs to send requests to YOUR Module 4 backend at:**

### Local Development:
```
http://localhost:8000
```

### Production (After you deploy Module 4):
```
https://YOUR-MODULE4-URL.run.app
```

---

## 🔌 API ENDPOINTS YOUR FRIEND CAN USE

Based on `module4-server.py`, your Module 4 exposes these REST endpoints:

### 1. Health Check
```http
GET http://localhost:8000/health
```
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-03T..."
}
```

### 2. Load Sample Data
```http
GET http://localhost:8000/load-sample-data
```
**What it does:** Fetches sample input data from your friend's backend

**Response:**
```json
{
  "status": "success",
  "message": "Sample data loaded...",
  "topic": "...",
  "text": "...",
  "significance_score": 0.8,
  "total_search_items": 512,
  "timestamp": "..."
}
```

### 3. Start Analysis/Processing
```http
POST http://localhost:8000/process
Content-Type: application/json

{
  "topic": "Topic text",
  "text": "Main content",
  "significance_score": 0.75
}
```

**Response:**
```json
{
  "status": "completed",
  "message": "Analysis completed successfully",
  "generated_files": 3,
  "progress": 100.0
}
```

### 4. Get Results
```http
GET http://localhost:8000/results
```

**Response:**
```json
{
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "...",
      "trust_score": 0.75,
      "source_type": "...",
      "relevance_confidence": 0.95,
      "perspective": "common|leftist|rightist"
    }
  ]
}
```

### 5. Start Debate
```http
POST http://localhost:8000/debate
```

**Response:**
```json
{
  "status": "completed",
  "message": "Debate completed successfully",
  "trust_score": 55,
  "debate_file": "debate_result.json"
}
```

### 6. Get Debate Result
```http
GET http://localhost:8000/debate/result
```

**Response:**
```json
{
  "topic": "...",
  "trust_score": 55,
  "judgment": "..."
}
```

### 7. Get Status
```http
GET http://localhost:8000/status
```

**Response:**
```json
{
  "status": "ready",
  "timestamp": "...",
  "modules_available": {
    "analysis": true,
    "debate": true
  }
}
```

---

## 📤 WHAT YOUR FRIEND'S BACKEND SHOULD PROVIDE

Your Module 4 expects these endpoints from your friend's backend:

### 1. Sample Input Data
```http
GET https://idk-backend-382118575811.asia-south1.run.app/data/sample-input
```

**Expected Response:**
```json
{
  "topic": "Topic text",
  "text": "Content text",
  "significance_score": 0.8,
  "timestamp": "..."
}
```

### 2. All Perspectives Data
```http
GET https://idk-backend-382118575811.asia-south1.run.app/data/perspectives/all
```

**Expected Response:**
```json
{
  "total_search_items": 512,
  "items": [...]
}
```

---

## 🔄 INTEGRATION FLOW

```
Your Friend's Backend (Module 3)
         ↓
   (provides perspectives)
         ↓
YOUR Module 4 Server (localhost:8000)
         ↓
   (processes & debates)
         ↓
  Your Frontend (Module 4 UI)
```

---

## 🚀 TO DEPLOY YOUR MODULE 4 TO GCP:

1. **Create Dockerfile for Module 4:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY module4-server.py .
COPY main.py .
COPY debate.py .
COPY data/ ./data/

EXPOSE 8000

CMD ["uvicorn", "module4-server:app", "--host", "0.0.0.0", "--port", "8000"]
```

2. **Deploy to Cloud Run:**
```bash
cd /path/to/module4
gcloud run deploy module4-backend \
  --source . \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --port 8000
```

3. **Get your URL:**
```
https://module4-backend-XXXXX-el.a.run.app
```

4. **Share this URL with your friend!**

---

## 📝 SUMMARY

### ✅ Done:
- Module 4 points to: `https://idk-backend-382118575811.asia-south1.run.app`
- frontend-reference folder removed
- Module 4 component already in place

### 📡 Your Friend Needs:
**Your Module 4 URL:** (after you deploy)
- Local: `http://localhost:8000`
- Production: `https://YOUR-MODULE4-URL.run.app`

### 🔌 Endpoints for Integration:
See "API ENDPOINTS YOUR FRIEND CAN USE" section above

---

## 🆘 CORS Configuration

If your friend gets CORS errors, they need to add your URLs to their backend:

```python
allow_origins=[
    "http://localhost:8000",
    "https://YOUR-MODULE4-URL.run.app",
    "https://idkai-frontend-XXXXX-el.a.run.app"  # Your frontend
]
```
