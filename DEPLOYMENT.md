# Deployment Guide

## Environment Variables Configuration

All modules now read from a **single root `.env` file** for easier deployment.

### Local Development

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your actual API keys in `.env`

3. Start services:
   ```bash
   ./start-all.bat
   ```

---

## Vercel Deployment (Frontend)

### Step 1: Push to GitHub
```bash
git add .
git commit -m "Deploy to Vercel"
git push origin main
```

### Step 2: Import to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "Import Project"
3. Select your GitHub repository
4. Set **Root Directory** to `frontend`

### Step 3: Configure Environment Variables
In Vercel Dashboard → Settings → Environment Variables, add:

```
NEXT_PUBLIC_ORCHESTRATOR_URL=https://your-backend-url.run.app
```

### Step 4: Deploy
- Vercel will auto-deploy on push to main branch
- Frontend will be live at `https://your-project.vercel.app`

---

## GCP Cloud Run Deployment (Backend)

### Prerequisites
```bash
# Install gcloud CLI
# https://cloud.google.com/sdk/docs/install

# Login
gcloud auth login

# Set project
gcloud config set project YOUR_PROJECT_ID
```

### Deploy Orchestrator
```bash
cd orchestrator
gcloud run deploy orchestrator \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "MODULE1_HOST=module1-xxxxxxx.run.app,MODULE3_HOST=module3-xxxxxxx.run.app"
```

### Deploy Module 1 (Scam Detection)
```bash
cd module1/backend
gcloud run deploy module1 \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=your_key_here,MODULE1_PORT=8080"
```

### Deploy Module 3 (Perspective API)
```bash
cd module3/backend
gcloud run deploy module3 \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "VERTEX_ENDPOINT=your_endpoint,GENAI_API_KEY=your_key,MODULE3_PORT=8080"
```

### Update Orchestrator URLs
After deploying modules, get their URLs and update orchestrator:
```bash
gcloud run services describe module1 --format='value(status.url)'
gcloud run services describe module3 --format='value(status.url)'
```

Then redeploy orchestrator with updated env vars.

---

## Environment Variables Reference

### Module 1 (Scam Detection)
- `GEMINI_API_KEY` - Google Gemini AI API key
- `MODULE1_PORT` - Port (default: 8001, Cloud Run uses 8080)

### Module 3 (Perspective Analysis)
- `VERTEX_ENDPOINT` - Google Vertex AI endpoint URL
- `GENAI_API_KEY` - GenAI API key
- `MODULE3_PORT` - Port (default: 8002, Cloud Run uses 8080)
- `GOOGLE_APPLICATION_CREDENTIALS` (optional) - Service account JSON path

### Orchestrator
- `MODULE1_HOST` - Module 1 service URL
- `MODULE3_HOST` - Module 3 service URL
- `FRONTEND_HOST` - Frontend URL (for CORS)

---

## Docker Deployment (Alternative)

### Build Images
```bash
# Module 1
docker build -t module1:latest ./module1/backend

# Module 3
docker build -t module3:latest ./module3/backend

# Orchestrator
docker build -t orchestrator:latest .
```

### Run with Environment Variables
```bash
docker run -d -p 8001:8001 \
  --env-file .env \
  module1:latest

docker run -d -p 8002:8002 \
  --env-file .env \
  module3:latest
```

---

## Security Notes

⚠️ **NEVER commit `.env` file to git!**
- `.env` is in `.gitignore`
- Use `.env.example` as template
- Set secrets via platform dashboards (Vercel/GCP)

✅ **Best Practices:**
- Rotate API keys regularly
- Use different keys for dev/prod
- Enable API key restrictions in Google Cloud Console
- Use service accounts for GCP resources

---

## Troubleshooting

### "No module named 'PIL'"
```bash
pip install Pillow
```

### "GEMINI_API_KEY not found"
Check that `.env` file exists in root directory and contains:
```
GEMINI_API_KEY=your_key_here
```

### "VERTEX_ENDPOINT not found"
Ensure root `.env` has:
```
VERTEX_ENDPOINT=projects/your-project/locations/region/endpoints/id
```

### Frontend can't reach backend
- Check `NEXT_PUBLIC_ORCHESTRATOR_URL` in Vercel env vars
- Ensure backend services allow CORS from frontend domain
- Verify orchestrator is running and accessible

---

## Support

For issues, check:
1. All services are running (`./start-all.bat`)
2. Root `.env` file exists with all required keys
3. No port conflicts (8000, 8001, 8002, 3001)
4. Dependencies installed (`pip install -r requirements.txt`)
