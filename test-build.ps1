#!/usr/bin/env pwsh
# Test build script for Vercel deployment

Write-Host "Testing frontend build for Vercel..." -ForegroundColor Cyan

# Navigate to frontend
Set-Location frontend

Write-Host "`n1. Installing dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Dependency installation failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n2. Running build..." -ForegroundColor Yellow
$env:NEXT_PUBLIC_API_URL = "https://placeholder-backend.com"
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed! Fix errors before deploying." -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Build successful! Ready for Vercel deployment." -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Go to https://vercel.com/new" -ForegroundColor White
Write-Host "2. Import your repository" -ForegroundColor White
Write-Host "3. Set root directory to 'frontend'" -ForegroundColor White
Write-Host "4. Click Deploy" -ForegroundColor White
Write-Host "`n5. After backend is ready, add environment variable:" -ForegroundColor White
Write-Host "   NEXT_PUBLIC_API_URL = your-backend-url" -ForegroundColor Yellow

Set-Location ..
