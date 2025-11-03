#!/usr/bin/env pwsh
# Quick redeploy script using Cloud Build with caching

Write-Host "🚀 Deploying Frontend with Cached Build" -ForegroundColor Cyan
Write-Host "URL will remain: https://idkai-frontend-XXXXX-el.a.run.app" -ForegroundColor Green
Write-Host ""

# Submit build
gcloud builds submit --config cloudbuild.yaml .

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Deployment successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🌐 Get your URL:" -ForegroundColor Cyan
    gcloud run services describe idkai-frontend --region asia-south1 --format='value(status.url)'
    Write-Host ""
    Write-Host "💡 Next deployments will be faster due to caching!" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    Write-Host "View logs at: https://console.cloud.google.com/cloud-build/builds" -ForegroundColor Yellow
}
