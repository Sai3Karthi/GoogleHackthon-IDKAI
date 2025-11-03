# 🚀 QUICK START: Deploy Frontend to Google Cloud

## Prerequisites (One-Time Setup)

### 1. Install Google Cloud CLI
```powershell
# Download and run installer
https://cloud.google.com/sdk/docs/install
```

### 2. Login and Setup
```bash
# Login to Google Cloud
gcloud auth login

# Set your project ID
gcloud config set project YOUR_PROJECT_ID

# Enable APIs (only once)
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

---

## 🎯 DEPLOY NOW (One Command)

### Option 1: Using PowerShell Script
```powershell
./deploy-gcp.ps1
```

### Option 2: Manual Command
```bash
cd frontend
gcloud run deploy idkai-frontend --source . --region us-central1 --allow-unauthenticated
```

**Time: 3-5 minutes**

---

## ✅ What You'll Get

After deployment completes:
- ✅ Live URL: `https://idkai-frontend-RANDOM.run.app`
- ✅ HTTPS enabled automatically
- ✅ Auto-scaling (0 to 10 instances)
- ✅ Free tier: 2 million requests/month

---

## 🔧 Update Backend URL

After backend is deployed:
```bash
gcloud run services update idkai-frontend \
  --update-env-vars NEXT_PUBLIC_API_URL=https://your-backend-url.com \
  --region us-central1
```

---

## 📋 Files Created for Google Cloud

### New Files:
- ✅ `frontend/Dockerfile` - Docker build configuration
- ✅ `frontend/.dockerignore` - Exclude unnecessary files
- ✅ `frontend/app.yaml` - App Engine config (optional)
- ✅ `GCP_DEPLOY.md` - Complete deployment guide
- ✅ `deploy-gcp.ps1` - Quick deployment script

### Updated Files:
- ✅ `frontend/next.config.js` - Added standalone output
- ✅ `frontend/package.json` - Removed Vercel script

### Removed Files:
- ❌ All Vercel-related files deleted

---

## 🆘 Troubleshooting

### "gcloud: command not found"
Install Google Cloud CLI: https://cloud.google.com/sdk/docs/install

### "No project configured"
```bash
gcloud config set project YOUR_PROJECT_ID
```

### View Build Logs
```bash
gcloud builds list --limit 5
gcloud builds log BUILD_ID
```

### View Service Logs
```bash
gcloud run services logs idkai-frontend --region us-central1 --follow
```

---

## 💰 Cost

**Free Tier Includes:**
- 2 million requests/month
- 360,000 GB-seconds/month
- 180,000 vCPU-seconds/month

Most small projects stay within free tier!

---

## 🎉 Ready?

```bash
./deploy-gcp.ps1
```

Your frontend will be live in minutes! 🚀
