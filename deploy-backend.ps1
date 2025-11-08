#!/usr/bin/env pwsh
# Deploy all backend modules to Google Cloud Run

Write-Host "Deploying IDK-AI backend modules to Google Cloud Run" -ForegroundColor Cyan
Write-Host "This will deploy: Orchestrator + Module1 + Module2 + Module3 + Module4" -ForegroundColor White
Write-Host ""

# Check if gcloud is installed
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "Google Cloud CLI not found." -ForegroundColor Red
    Write-Host "Install from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# Get project ID
$projectId = gcloud config get-value project 2>$null
if (-not $projectId) {
    Write-Host "No Google Cloud project configured." -ForegroundColor Red
    Write-Host "Run: gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Yellow
    exit 1
}

Write-Host "Project: $projectId" -ForegroundColor Green

# Get API keys
$geminiApiKey = Read-Host "Enter your Google Gemini API key"
if (-not $geminiApiKey) {
    Write-Host "Gemini API key is required." -ForegroundColor Red
    exit 1
}

$googleApiKey = Read-Host "Enter your Google API key (for Custom Search, optional)"
if (-not $googleApiKey) {
    Write-Host "No Google API key provided. Enrichment features will be limited." -ForegroundColor Yellow
}

# Gather deployed endpoints for environment configuration
$defaultBackendUrl = "https://idkai-backend-454838348123.asia-south1.run.app"
$backendPrompt = "Enter deployed backend base URL (orchestrator). Press Enter to use default [$defaultBackendUrl]"
$deployedBackendUrl = Read-Host $backendPrompt
if (-not $deployedBackendUrl) {
    $deployedBackendUrl = $defaultBackendUrl
}

$defaultFrontendUrl = "https://idkai-frontend-454838348123.asia-south1.run.app"
$frontendPrompt = "Enter deployed frontend base URL. Press Enter to use default [$defaultFrontendUrl]"
$deployedFrontendUrl = Read-Host $frontendPrompt
if (-not $deployedFrontendUrl) {
    $deployedFrontendUrl = $defaultFrontendUrl
}

# Common environment variables
$envVars = @("GEMINI_API_KEY=$geminiApiKey", "DEPLOYED_BACKEND_URL=$deployedBackendUrl", "DEPLOYED_FRONTEND_URL=$deployedFrontendUrl")
if ($googleApiKey) {
    $envVars += "GOOGLE_API_KEY=$googleApiKey"
}
$commonEnvVars = ($envVars -join ",")

# Module configurations
$modules = @(
    @{
        Name = "orchestrator"
        Source = "."
        Dockerfile = "orchestrator/Dockerfile"
        Port = 8000
        Description = "API Gateway and Proxy"
    },
    @{
        Name = "module1"
        Source = "."
        Dockerfile = "module1/backend/Dockerfile"
        Port = 8001
        Description = "Link Verification & Scam Detection"
    },
    @{
        Name = "module2"
        Source = "."
        Dockerfile = "Module2/backend/Dockerfile"
        Port = 8002
        Description = "Information Classification & Significance Scoring"
    },
    @{
        Name = "module3"
        Source = "."
        Dockerfile = "module3/backend/Dockerfile"
        Port = 8003
        Description = "Perspective Generation"
    },
    @{
        Name = "module4"
        Source = "."
        Dockerfile = "module4/backend/Dockerfile"
        Port = 8004
        Description = "Agent Debate & Analysis"
    }
)

$deployedServices = @()
$failedServices = @()

foreach ($module in $modules) {
    Write-Host ""
    Write-Host "Deploying $($module.Name) ($($module.Description))..." -ForegroundColor Cyan

    try {
    $deployCommand = "gcloud run deploy idkai-$($module.Name) --source $($module.Source) --dockerfile $($module.Dockerfile) --platform managed --region us-central1 --allow-unauthenticated --port $($module.Port) --set-env-vars $commonEnvVars --memory 1Gi --cpu 1 --max-instances 5 --timeout 900"

    Write-Host "Command: $deployCommand" -ForegroundColor Gray

        # Execute deployment
        Invoke-Expression $deployCommand

        if ($LASTEXITCODE -eq 0) {
            Write-Host "$($module.Name) deployed successfully." -ForegroundColor Green
            $deployedServices += $module.Name
        } else {
            Write-Host "$($module.Name) deployment failed." -ForegroundColor Red
            $failedServices += $module.Name
        }
    } catch {
        Write-Host "$($module.Name) deployment failed with error: $($_.Exception.Message)" -ForegroundColor Red
        $failedServices += $module.Name
    }
}

Write-Host ""
Write-Host "Deployment summary:" -ForegroundColor Cyan
Write-Host "Successful: $($deployedServices.Count)" -ForegroundColor Green
if ($deployedServices.Count -gt 0) {
    Write-Host "   $($deployedServices -join ', ')" -ForegroundColor White
}

if ($failedServices.Count -gt 0) {
    Write-Host "Failed: $($failedServices.Count)" -ForegroundColor Red
    Write-Host "   $($failedServices -join ', ')" -ForegroundColor White
}

if ($deployedServices.Count -gt 0) {
    Write-Host ""
    Write-Host "Service URLs:" -ForegroundColor Cyan

    foreach ($serviceName in $deployedServices) {
        try {
            $url = gcloud run services describe "idkai-$serviceName" --region us-central1 --format='value(status.url)' 2>$null
            if ($url) {
                Write-Host "   $serviceName : $url" -ForegroundColor White
            }
        } catch {
            Write-Host "   $serviceName : Unable to get URL" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "Update frontend configuration:" -ForegroundColor Cyan
    Write-Host "Set NEXT_PUBLIC_API_URL to the orchestrator URL in your frontend deployment" -ForegroundColor White
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Gray
    Write-Host "gcloud run services update idkai-frontend --update-env-vars NEXT_PUBLIC_API_URL=https://idkai-orchestrator-XXXX.run.app --region us-central1" -ForegroundColor Gray
}

if ($failedServices.Count -gt 0) {
    Write-Host ""
    Write-Host "Troubleshooting failed deployments:" -ForegroundColor Yellow
    Write-Host "1. Check build logs: gcloud builds list --limit 5" -ForegroundColor White
    Write-Host "2. View detailed logs: gcloud builds log BUILD_ID" -ForegroundColor White
    Write-Host "3. Check service logs: gcloud run services logs idkai-$($failedServices[0]) --region us-central1" -ForegroundColor White
    Write-Host "4. Ensure all requirements.txt files are present and correct" -ForegroundColor White
}

Write-Host ""
if ($deployedServices.Count -eq $modules.Count) {
    Write-Host "All backend services deployed successfully." -ForegroundColor Green
} elseif ($deployedServices.Count -gt 0) {
    Write-Host "Partial deployment completed. Some services failed." -ForegroundColor Yellow
} else {
    Write-Host "All deployments failed. Check your configuration and try again." -ForegroundColor Red
}

Write-Host ""
Write-Host "Tips:" -ForegroundColor Cyan
Write-Host "- Backend services auto-scale from 0 to 5 instances" -ForegroundColor White
Write-Host "- Each service has 1Gi RAM and 1 CPU allocated" -ForegroundColor White
Write-Host "- Request timeout is 15 minutes (900 seconds)" -ForegroundColor White
Write-Host "- Services are publicly accessible (allow-unauthenticated)" -ForegroundColor White
