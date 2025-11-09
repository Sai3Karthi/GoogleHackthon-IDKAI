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

$repoRoot = Split-Path -Parent $PSCommandPath
$configPath = Join-Path $repoRoot 'config.ini'

function Get-OrchestratorUrl {
    if ($env:NEXT_PUBLIC_API_URL) {
        return $env:NEXT_PUBLIC_API_URL.TrimEnd('/')
    }

    if (Test-Path $configPath) {
        $section = $null
        foreach ($line in Get-Content $configPath) {
            $trimmed = $line.Trim()
            if (-not $trimmed -or $trimmed.StartsWith('#') -or $trimmed.StartsWith(';')) {
                continue
            }
            if ($trimmed.StartsWith('[') -and $trimmed.EndsWith(']')) {
                $section = $trimmed.Trim('[', ']')
                continue
            }
            if ($section -eq 'orchestrator' -and $trimmed -match '^service_url\s*=\s*(.+)$') {
                $url = $Matches[1].Trim()
                if ($url) {
                    return $url.TrimEnd('/')
                }
            }
        }
    }

    if ($env:DEPLOYED_BACKEND_URL) {
        return $env:DEPLOYED_BACKEND_URL.TrimEnd('/')
    }

    return 'https://idkai-backend-454838348123.asia-south1.run.app'
}

$serviceName = $env:FRONTEND_SERVICE_NAME
if (-not $serviceName) {
    $serviceName = 'idkai-frontend'
}

$region = $env:GCLOUD_REGION
if (-not $region) {
    $region = 'asia-south1'
}

$apiUrl = Get-OrchestratorUrl

Write-Host "Service Name        : $serviceName" -ForegroundColor Cyan
Write-Host "Region              : $region" -ForegroundColor Cyan
Write-Host "NEXT_PUBLIC_API_URL : $apiUrl" -ForegroundColor Cyan

$envVars = "NEXT_PUBLIC_API_URL=$apiUrl"

Push-Location (Join-Path $repoRoot 'frontend')

$envFilePath = Join-Path (Get-Location) '.env.production'
$hadEnvFile = Test-Path $envFilePath
$previousEnvContent = $null
if ($hadEnvFile) {
    $previousEnvContent = Get-Content $envFilePath -Raw
}

$envLines = @()
if ($hadEnvFile -and $previousEnvContent) {
    $envLines = $previousEnvContent -split "`r?`n"
    $envLines = $envLines | Where-Object { $_ -notmatch '^NEXT_PUBLIC_API_URL=' }
}
$envLines += "NEXT_PUBLIC_API_URL=$apiUrl"
Set-Content -Path $envFilePath -Value $envLines -Encoding UTF8

Write-Host "Building and deploying $serviceName in $region (project $projectId)..." -ForegroundColor Cyan

$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$imageTag = "asia-south1-docker.pkg.dev/$projectId/cloud-run-source-deploy/${serviceName}:${timestamp}"

$buildCommand = @(
    "builds", "submit", ".",
    "--tag", $imageTag,
    "--region", $region
)

$exitCode = 0

try {
    $previousNextPublicApi = $env:NEXT_PUBLIC_API_URL
    $env:NEXT_PUBLIC_API_URL = $apiUrl

    gcloud @buildCommand
    if ($LASTEXITCODE -ne 0) {
        $exitCode = $LASTEXITCODE
        throw "Cloud Build failed"
    }

    $deployCommand = @(
        "run", "deploy", $serviceName,
        "--image", $imageTag,
        "--platform", "managed",
        "--region", $region,
        "--allow-unauthenticated",
        "--port", "3000",
        "--set-env-vars", $envVars
    )

    gcloud @deployCommand
    $exitCode = $LASTEXITCODE
}
finally {
    $env:NEXT_PUBLIC_API_URL = $previousNextPublicApi

    if ($hadEnvFile) {
        Set-Content -Path $envFilePath -Value $previousEnvContent -Encoding UTF8
    } else {
        Remove-Item -Path $envFilePath -ErrorAction SilentlyContinue
    }

    Pop-Location
}

if ($exitCode -ne 0) {
    Write-Host "Deployment failed. Inspect Cloud Build or Cloud Run logs for details." -ForegroundColor Red
    exit $exitCode
}

Write-Host "Deployment completed successfully." -ForegroundColor Green

$serviceUrl = gcloud run services describe $serviceName --region $region --format='value(status.url)' 2>$null
if ($serviceUrl) {
    Write-Host "Service URL: $serviceUrl" -ForegroundColor Green
    Write-Host "To update NEXT_PUBLIC_API_URL later, run:" -ForegroundColor Cyan
    Write-Host "gcloud run services update $serviceName --region $region --update-env-vars NEXT_PUBLIC_API_URL=$apiUrl" -ForegroundColor Yellow
} else {
    Write-Host "Unable to retrieve service URL automatically. Check Google Cloud Console." -ForegroundColor Yellow
}
