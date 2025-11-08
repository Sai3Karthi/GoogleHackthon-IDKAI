#!/usr/bin/env pwsh
# Fast deployment script for the Next.js frontend to Google Cloud Run

Write-Host "Deploying IDK-AI Frontend to Google Cloud Run" -ForegroundColor Cyan

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "Google Cloud CLI not found. Install from https://cloud.google.com/sdk/docs/install" -ForegroundColor Red
    exit 1
}

$projectId = gcloud config get-value project 2>$null
if (-not $projectId) {
    Write-Host "No Google Cloud project configured. Run 'gcloud config set project <PROJECT_ID>' first." -ForegroundColor Red
    exit 1
}

$defaultService = "idkai-frontend"
$serviceNameInput = Read-Host "Enter Cloud Run service name [$defaultService]"
$serviceName = if ($serviceNameInput) { $serviceNameInput } else { $defaultService }

$defaultRegion = "asia-south1"
$regionInput = Read-Host "Enter deployment region [$defaultRegion]"
$region = if ($regionInput) { $regionInput } else { $defaultRegion }

$defaultApiUrl = $env:NEXT_PUBLIC_API_URL
if (-not $defaultApiUrl) {
    $defaultApiUrl = "https://idkai-backend-454838348123.asia-south1.run.app"
}
$apiUrlInput = Read-Host "Enter orchestrator API URL (NEXT_PUBLIC_API_URL) [$defaultApiUrl]"
$apiUrl = if ($apiUrlInput) { $apiUrlInput } else { $defaultApiUrl }

$envArgs = "NEXT_PUBLIC_API_URL=$apiUrl"

Push-Location frontend

Write-Host "Building and deploying $serviceName in $region (project $projectId)..." -ForegroundColor Cyan

$deployCommand = @(
    "run", "deploy", $serviceName,
    "--source", ".",
    "--platform", "managed",
    "--region", $region,
    "--allow-unauthenticated",
    "--port", "3000",
    "--set-env-vars", $envArgs
)

gcloud @deployCommand
$exitCode = $LASTEXITCODE

Pop-Location

if ($exitCode -ne 0) {
    Write-Host "Deployment failed. Use 'gcloud builds list --limit 5' to inspect recent builds." -ForegroundColor Red
    exit $exitCode
}

Write-Host "Deployment completed successfully." -ForegroundColor Green

$serviceUrl = gcloud run services describe $serviceName --region $region --format='value(status.url)' 2>$null
if ($serviceUrl) {
    Write-Host "Service URL: $serviceUrl" -ForegroundColor Green
    Write-Host "To update NEXT_PUBLIC_API_URL later, run:" -ForegroundColor Cyan
    Write-Host "gcloud run services update $serviceName --update-env-vars NEXT_PUBLIC_API_URL=$apiUrl --region $region" -ForegroundColor Yellow
} else {
    Write-Host "Unable to retrieve service URL automatically. Check Google Cloud Console." -ForegroundColor Yellow
}
