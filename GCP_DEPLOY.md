# Google Cloud Deployment Guide

## Quick Deploy to Google Cloud Run (5 Minutes)

### Prerequisites
1. Google Cloud account with billing enabled
2. Google Cloud CLI (`gcloud`) installed
3. Docker installed (for local testing)

### Step 1: Install Google Cloud CLI

**Windows (PowerShell):**
```powershell
(New-Object Net.WebClient).DownloadFile("https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe", "$env:Temp\GoogleCloudSDKInstaller.exe")
& $env:Temp\GoogleCloudSDKInstaller.exe
```

**Or download from:** https://cloud.google.com/sdk/docs/install

### Step 2: Initialize and Login

```bash
# Login to Google Cloud
gcloud auth login

# Set your project (replace YOUR_PROJECT_ID)
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

### Step 3: Deploy Frontend to Cloud Run (Fast Script)

```powershell
# From repository root
./deploy-frontend.ps1
```

The script prompts for the service name, region, and orchestrator API URL (`NEXT_PUBLIC_API_URL`) and runs `gcloud run deploy` from the `frontend/` directory. It defaults to `idkai-frontend`, region `asia-south1`, and the currently deployed orchestrator URL.

#### Manual Command (optional)

```bash
cd frontend

gcloud run deploy idkai-frontend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars NEXT_PUBLIC_API_URL=YOUR_BACKEND_URL
```

**Time: 3-5 minutes**

### Step 4: Get Your Live URL

After deployment, you'll see:
```
Service [idkai-frontend] revision [idkai-frontend-00001] has been deployed
and is serving 100 percent of traffic.
Service URL: https://idkai-frontend-RANDOM.run.app
```

**This is your live URL!**

---

## Alternative: Deploy Using Dockerfile

### Build Docker Image Locally
```bash
cd frontend

# Build the image
docker build -t idkai-frontend .

# Test locally
docker run -p 3000:3000 -e NEXT_PUBLIC_API_URL=http://localhost:8000 idkai-frontend

# Visit http://localhost:3000
```

### Push to Google Cloud
```bash
# Tag for Google Container Registry
docker tag idkai-frontend gcr.io/YOUR_PROJECT_ID/idkai-frontend

# Push to GCR
docker push gcr.io/YOUR_PROJECT_ID/idkai-frontend

# Deploy to Cloud Run
gcloud run deploy idkai-frontend \
  --image gcr.io/YOUR_PROJECT_ID/idkai-frontend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars NEXT_PUBLIC_API_URL=YOUR_BACKEND_URL
```

---

## Alternative: Deploy to App Engine

```bash
cd frontend

# Update app.yaml with your backend URL
# Then deploy
gcloud app deploy

# Get your URL
gcloud app browse
```

---

## Environment Variables

Set environment variables during deployment:

```bash
gcloud run deploy idkai-frontend \
  --source . \
  --set-env-vars NEXT_PUBLIC_API_URL=https://your-backend.run.app \
  --region us-central1
```

For backend services, ensure the deployed endpoints propagate via environment variables so every module resolves URLs through `config_loader`:

```bash
gcloud run deploy idkai-orchestrator \
  --source . \
  --set-env-vars GEMINI_API_KEY=your-key,DEPLOYED_BACKEND_URL=https://idkai-backend-454838348123.asia-south1.run.app,DEPLOYED_FRONTEND_URL=https://idkai-frontend-454838348123.asia-south1.run.app,ORCHESTRATOR_SERVICE_URL=https://idkai-backend-454838348123.asia-south1.run.app,FRONTEND_SERVICE_URL=https://idkai-frontend-454838348123.asia-south1.run.app \
  --region us-central1
```

Repeat the same `DEPLOYED_BACKEND_URL` and `DEPLOYED_FRONTEND_URL` values for module1 through module4 so that runtime requests always route through the orchestrator proxy.

After deployment, record each module's Cloud Run URL and update the orchestrator with:

```bash
gcloud run services update idkai-orchestrator \
  --region us-central1 \
  --update-env-vars MODULE1_SERVICE_URL=https://idkai-module1-XXXX.run.app,MODULE2_SERVICE_URL=https://idkai-module2-XXXX.run.app,MODULE3_SERVICE_URL=https://idkai-module3-XXXX.run.app,MODULE4_SERVICE_URL=https://idkai-module4-XXXX.run.app
```

Or update after deployment:
```bash
gcloud run services update idkai-frontend \
  --update-env-vars NEXT_PUBLIC_API_URL=https://your-backend.run.app \
  --region us-central1
```

---

## Configuration Options

### Scaling Configuration
```bash
gcloud run deploy idkai-frontend \
  --source . \
  --min-instances 0 \
  --max-instances 10 \
  --cpu 1 \
  --memory 512Mi \
  --region us-central1
```

### Custom Domain
```bash
# Map custom domain
gcloud run domain-mappings create \
  --service idkai-frontend \
  --domain your-domain.com \
  --region us-central1
```

---

## Cost Estimates

**Cloud Run Pricing (Free Tier):**
- 2 million requests/month FREE
- 360,000 GB-seconds FREE
- 180,000 vCPU-seconds FREE

**Typical costs after free tier:**
- ~$0.40 per million requests
- ~$0.000024 per GB-second
- Very cost-effective for low-medium traffic

---

## Deployment Files Created

### Files Added:
1. **`frontend/Dockerfile`** - Multi-stage Docker build
2. **`frontend/.dockerignore`** - Exclude unnecessary files
3. **`frontend/app.yaml`** - App Engine configuration (optional)

### Files Updated:
1. **`frontend/next.config.js`** - Added `output: 'standalone'`
2. **`frontend/package.json`** - Removed vercel-build script

### Files Removed:
1. `frontend/vercel.json`
2. `frontend/.vercelignore`
3. `frontend/DEPLOY.md`
4. `VERCEL_DEPLOY.md`
5. `VERCEL_FIX.md`
6. `DEPLOYMENT_CHECKLIST.md`
7. `READY_TO_DEPLOY.md`

---

## Testing After Deployment

1. Visit your Cloud Run URL
2. Test Module 1 (text/image analysis)
3. Navigate between modules
4. Test "New Session" button
5. Verify session persistence works

---

## Troubleshooting

### Build Fails?
```bash
# Check build logs
gcloud builds list --limit 5
gcloud builds log BUILD_ID
```

### Service Not Responding?
```bash
# Check service logs
gcloud run services logs idkai-frontend --region us-central1
```

### Need to Rollback?
```bash
# List revisions
gcloud run revisions list --service idkai-frontend --region us-central1

# Rollback to previous revision
gcloud run services update-traffic idkai-frontend \
  --to-revisions REVISION_NAME=100 \
  --region us-central1
```

### CORS Issues with Backend?
Add your Cloud Run URL to backend CORS settings:
```python
allow_origins=[
    "https://idkai-frontend-RANDOM.run.app",
    "https://*.run.app"  # For all Cloud Run domains
]
```

---

## CI/CD with Cloud Build (Optional)

Create `cloudbuild.yaml`:
```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/idkai-frontend', './frontend']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/idkai-frontend']
  - name: 'gcr.io/cloud-builders/gcloud'
    args:
      - 'run'
      - 'deploy'
      - 'idkai-frontend'
      - '--image=gcr.io/$PROJECT_ID/idkai-frontend'
      - '--region=us-central1'
      - '--platform=managed'
```

Setup trigger:
```bash
gcloud builds triggers create github \
  --repo-name=GoogleHackthon-IDKAI \
  --repo-owner=Sai3Karthi \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml
```

---

## Quick Commands Reference

```bash
# Deploy/Update
gcloud run deploy idkai-frontend --source ./frontend --region us-central1

# View logs
gcloud run services logs idkai-frontend --region us-central1 --follow

# Get URL
gcloud run services describe idkai-frontend --region us-central1 --format='value(status.url)'

# Delete service
gcloud run services delete idkai-frontend --region us-central1

# Update environment variables
gcloud run services update idkai-frontend \
  --update-env-vars NEXT_PUBLIC_API_URL=new-backend-url \
  --region us-central1
```

---

## Ready to Deploy?

```bash
cd frontend
gcloud run deploy idkai-frontend --source . --region us-central1 --allow-unauthenticated
```

**That's it!** Your frontend will be live in 3-5 minutes.

---

## Support

- **Google Cloud Run Docs:** https://cloud.google.com/run/docs
- **Next.js Docker Docs:** https://nextjs.org/docs/deployment#docker-image
- **Cloud Build Docs:** https://cloud.google.com/build/docs
