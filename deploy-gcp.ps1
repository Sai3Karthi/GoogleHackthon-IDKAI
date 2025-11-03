#!/usr/bin/env pwsh
# Quick deployment script for Google Cloud Run

Write-Host "🚀 Deploying Frontend to Google Cloud Run" -ForegroundColor Cyan

# Check if gcloud is installed
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Google Cloud CLI not found!" -ForegroundColor Red
    Write-Host "Install from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# Get project ID
$projectId = gcloud config get-value project 2>$null
if (-not $projectId) {
    Write-Host "❌ No Google Cloud project configured!" -ForegroundColor Red
    Write-Host "Run: gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Yellow
    exit 1
}

Write-Host "📦 Project: $projectId" -ForegroundColor Green

# Get backend URL (optional)
$backendUrl = Read-Host "Enter backend URL (or press Enter to skip)"
if (-not $backendUrl) {
    $backendUrl = "http://localhost:8000"
    Write-Host "⚠️  Using placeholder backend URL: $backendUrl" -ForegroundColor Yellow
}

# Deploy to Cloud Run
Write-Host "`n🔨 Building and deploying..." -ForegroundColor Cyan

Set-Location frontend

if ($backendUrl -ne "http://localhost:8000") {
    gcloud run deploy idkai-frontend `
        --source . `
        --platform managed `
        --region us-central1 `
        --allow-unauthenticated `
        --port 3000 `
        --set-env-vars NEXT_PUBLIC_API_URL=$backendUrl
} else {
    gcloud run deploy idkai-frontend `
        --source . `
        --platform managed `
        --region us-central1 `
        --allow-unauthenticated `
        --port 3000
}

Set-Location ..

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Deployment successful!" -ForegroundColor Green
    Write-Host "`n📱 Getting service URL..." -ForegroundColor Cyan
    
    $serviceUrl = gcloud run services describe idkai-frontend --region us-central1 --format='value(status.url)' 2>$null
    
    if ($serviceUrl) {
        Write-Host "`n🌐 Your frontend is live at:" -ForegroundColor Green
        Write-Host $serviceUrl -ForegroundColor White
        Write-Host "`nTo update backend URL later, run:" -ForegroundColor Cyan
        Write-Host "gcloud run services update idkai-frontend --update-env-vars NEXT_PUBLIC_API_URL=your-backend-url --region us-central1" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n❌ Deployment failed!" -ForegroundColor Red
    Write-Host "Check logs with: gcloud builds list --limit 5" -ForegroundColor Yellow
    exit 1
}
