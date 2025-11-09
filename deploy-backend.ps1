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

# Locate repo root and preload optional configuration
$script:RepoRoot = Split-Path -Parent $PSCommandPath
$script:EnvFilePath = Join-Path $script:RepoRoot '.env'
$script:EnvCache = $null

function ConvertTo-SecretValue([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $value
    }
    $parts = $value.Split('=', 2)
    if ($parts.Length -eq 2) {
        return $parts[1]
    }
    return $value
}

function Get-RepoEnvValue([string]$key) {
    if ([string]::IsNullOrWhiteSpace($key)) {
        return $null
    }

    $existing = [Environment]::GetEnvironmentVariable($key)
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
        return $existing
    }

    if ($null -eq $script:EnvCache) {
        $script:EnvCache = @{}
        if (Test-Path $script:EnvFilePath) {
            Get-Content $script:EnvFilePath | ForEach-Object {
                $line = $_.Trim()
                if (-not $line -or $line.StartsWith('#')) {
                    return
                }
                $pair = $line.Split('=', 2)
                if ($pair.Length -eq 2) {
                    $k = $pair[0].Trim()
                    $v = $pair[1].Trim()
                    if ($v.StartsWith('"') -and $v.EndsWith('"')) {
                        $v = $v.Trim('"')
                    }
                    if ($v.StartsWith("'") -and $v.EndsWith("'")) {
                        $v = $v.Trim("'")
                    }
                    $script:EnvCache[$k] = $v
                }
            }
        }
    }

    if ($script:EnvCache.ContainsKey($key)) {
        return $script:EnvCache[$key]
    }
    return $null
}

function Read-ValueWithDefault {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][string]$Key,
        [switch]$Required,
        [switch]$Normalize,
        [string]$FallbackValue
    )

    $default = Get-RepoEnvValue $Key
    if (-not $default -and $FallbackValue) {
        $default = $FallbackValue
    }
    $message = if ($default) { "$Prompt (Press Enter to reuse saved value)" } else { $Prompt }
    $userInput = Read-Host $message
    if ($userInput) {
        $value = if ($Normalize) { ConvertTo-SecretValue $userInput } else { $userInput }
    } else {
        $value = $default
    }

    if ($value) {
        $value = $value.Trim()
    }

    if ($Required -and [string]::IsNullOrWhiteSpace($value)) {
        Write-Host "$Key is required." -ForegroundColor Red
        exit 1
    }

    return $value
}

# Discover defaults from module4 config when .env lacks search engine id
$module4DefaultSearchId = $null
$module4ConfigPath = Join-Path $script:RepoRoot 'module4/backend/config.json'
if (-not (Get-RepoEnvValue 'SEARCH_ENGINE_ID') -and (Test-Path $module4ConfigPath)) {
    try {
        $module4Config = Get-Content $module4ConfigPath -Raw | ConvertFrom-Json
        if ($module4Config.search_engine_id) {
            $module4DefaultSearchId = [string]$module4Config.search_engine_id
        }
    } catch {
        # Ignore JSON parse errors; user will be prompted manually
    }
}

# Gather deployment secrets and configuration, defaulting to .env / config values
$geminiApiKey = Read-ValueWithDefault -Prompt "Enter your Google Gemini API key" -Key "GEMINI_API_KEY" -Required -Normalize
$databaseUrl = Read-ValueWithDefault -Prompt "Enter DATABASE_URL for the shared Postgres instance" -Key "DATABASE_URL" -Required
$vertexEndpoint = Read-ValueWithDefault -Prompt "Enter Vertex AI endpoint path for Module 3 (VERTEX_ENDPOINT)" -Key "VERTEX_ENDPOINT" -Required

$googleApiKey = Read-ValueWithDefault -Prompt "Enter your Google API key (for Custom Search, optional)" -Key "GOOGLE_API_KEY" -Normalize
if (-not $googleApiKey) {
    $googleApiKey = $geminiApiKey
    Write-Host "Using GEMINI_API_KEY as Google API key." -ForegroundColor Yellow
}

$webSearchKey = Read-ValueWithDefault -Prompt "Enter Web Search API key for enrichment (WEB_SEARCH_API_KEY, optional)" -Key "WEB_SEARCH_API_KEY" -Normalize
if (-not $webSearchKey -and $googleApiKey) {
    $webSearchKey = $googleApiKey
    Write-Host "Using provided Google API key as WEB_SEARCH_API_KEY." -ForegroundColor Yellow
}

$searchEngineId = Read-ValueWithDefault -Prompt "Enter Custom Search Engine ID (SEARCH_ENGINE_ID, optional)" -Key "SEARCH_ENGINE_ID" -Normalize -FallbackValue $module4DefaultSearchId

$defaultRegion = Get-RepoEnvValue 'GCLOUD_REGION'
if (-not $defaultRegion) {
    $defaultRegion = 'asia-south1'
}
$deployRegion = Read-ValueWithDefault -Prompt "Enter Cloud Run region" -Key "GCLOUD_REGION" -Required -FallbackValue $defaultRegion
Write-Host "Deploying to region: $deployRegion" -ForegroundColor Cyan

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
$envVars = @(
    "GEMINI_API_KEY=$geminiApiKey",
    "DATABASE_URL=$databaseUrl",
    "VERTEX_ENDPOINT=$vertexEndpoint",
    "DEPLOYED_BACKEND_URL=$deployedBackendUrl",
    "DEPLOYED_FRONTEND_URL=$deployedFrontendUrl",
    "ORCHESTRATOR_SERVICE_URL=$deployedBackendUrl",
    "FRONTEND_SERVICE_URL=$deployedFrontendUrl"
)
if ($googleApiKey) {
    $envVars += "GOOGLE_API_KEY=$googleApiKey"
}
if ($webSearchKey) {
    $envVars += "WEB_SEARCH_API_KEY=$webSearchKey"
}
if ($searchEngineId) {
    $envVars += "SEARCH_ENGINE_ID=$searchEngineId"
}
$commonEnvVarArgs = $envVars | ForEach-Object { "--set-env-vars=$_" }

# Module configurations
$modules = @(
    @{
        Key = "orchestrator"
        ServiceName = "idkai-backend"
        ImageName = "idkai-orchestrator"
        Dockerfile = "orchestrator/Dockerfile"
        Port = 8000
        Description = "API Gateway and Proxy"
    },
    @{
        Key = "module1"
        ServiceName = "idkai-module1"
        ImageName = "idkai-module1"
        Dockerfile = "module1/backend/Dockerfile"
        Port = 8001
        Description = "Link Verification & Scam Detection"
    },
    @{
        Key = "module2"
        ServiceName = "idkai-module2"
        ImageName = "idkai-module2"
        Dockerfile = "Module2/backend/Dockerfile"
        Port = 8002
        Description = "Information Classification & Significance Scoring"
    },
    @{
        Key = "module3"
        ServiceName = "idkai-module3"
        ImageName = "idkai-module3"
        Dockerfile = "module3/backend/Dockerfile"
        Port = 8003
        Description = "Perspective Generation"
    },
    @{
        Key = "module4"
        ServiceName = "idkai-module4"
        ImageName = "idkai-module4"
        Dockerfile = "module4/backend/Dockerfile"
        Port = 8004
        Description = "Agent Debate & Analysis"
    }
)

$orchestratorModule = $modules | Where-Object { $_.Key -eq 'orchestrator' }
$orchestratorServiceName = $orchestratorModule.ServiceName

$deployedServices = @()
$failedServices = @()
$serviceUrls = @{}

foreach ($module in $modules) {
    Write-Host ""
    Write-Host "Deploying $($module.Key) ($($module.Description))..." -ForegroundColor Cyan

    $imageTag = "gcr.io/$projectId/$($module.ImageName):latest"
    $serviceName = $module.ServiceName
    $tempConfigPath = [System.IO.Path]::GetTempFileName()
    $configContent = @"
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-f', '$($module.Dockerfile)', '-t', '$imageTag', '.']
images:
- '$imageTag'
"@
    Set-Content -Path $tempConfigPath -Value $configContent -Encoding UTF8

    $buildArgs = @('builds', 'submit', '--config', $tempConfigPath, '.')
    Write-Host "Build command: gcloud $($buildArgs -join ' ')" -ForegroundColor Gray

    $buildSucceeded = $true
    try {
        & gcloud @buildArgs
    } catch {
        $buildSucceeded = $false
        Write-Host "$($module.Key) build failed with error: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
        Remove-Item -Path $tempConfigPath -ErrorAction SilentlyContinue
    }

    if (-not $buildSucceeded -or $LASTEXITCODE -ne 0) {
        if ($buildSucceeded) {
            Write-Host "$($module.Key) build failed." -ForegroundColor Red
        }
        $failedServices += $module.Key
        continue
    }

    if ($module.Key -eq 'orchestrator') {
        Write-Host "Clearing existing secret/env bindings for orchestrator (if any)..." -ForegroundColor Gray

        foreach ($var in @('GEMINI_API_KEY','GOOGLE_API_KEY','WEB_SEARCH_API_KEY')) {
            $removeSecretArgs = @('run','services','update',$serviceName,'--region',$deployRegion,"--remove-secrets=$var")
            & gcloud @removeSecretArgs 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Secret binding removed (if present): $var" -ForegroundColor Gray
            } else {
                Write-Host "No secret binding removed for: $var" -ForegroundColor DarkYellow
            }
        }

        foreach ($var in @('GEMINI_API_KEY','GOOGLE_API_KEY','WEB_SEARCH_API_KEY')) {
            $clearEnvArgs = @('run','services','update',$serviceName,'--region',$deployRegion,"--clear-env-vars=$var")
            & gcloud @clearEnvArgs 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Environment variable cleared: $var" -ForegroundColor Gray
            } else {
                Write-Host "Env var not cleared: $var" -ForegroundColor DarkYellow
            }
        }
    }

    $deployArgs = @(
    'run', 'deploy', $serviceName,
    '--image', $imageTag,
    '--platform', 'managed',
    '--region', $deployRegion,
        '--allow-unauthenticated',
        '--port', [string]$module.Port
    )
    $deployArgs += $commonEnvVarArgs
    $deployArgs += @('--memory', '1Gi', '--cpu', '1', '--max-instances', '5', '--timeout', '900')

    Write-Host "Deploy command: gcloud $($deployArgs -join ' ')" -ForegroundColor Gray

    try {
        & gcloud @deployArgs
    } catch {
        Write-Host "$($module.Key) deployment failed with error: $($_.Exception.Message)" -ForegroundColor Red
        $failedServices += $module.Key
        continue
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "$($module.Key) deployed successfully." -ForegroundColor Green
        $deployedServices += $module.Key
    } else {
        Write-Host "$($module.Key) deployment failed." -ForegroundColor Red
        $failedServices += $module.Key
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

    foreach ($moduleKey in $deployedServices) {
        try {
            $moduleConfig = $modules | Where-Object { $_.Key -eq $moduleKey }
            if (-not $moduleConfig) { continue }
            $serviceName = $moduleConfig.ServiceName
            $url = & gcloud run services describe $serviceName --region $deployRegion --format='value(status.url)' 2>$null
            if ($url) {
                $serviceUrls[$moduleKey] = $url
                Write-Host "   $serviceName : $url" -ForegroundColor White
            } else {
                Write-Host "   $serviceName : Unable to get URL" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "   $serviceName : Unable to get URL" -ForegroundColor Yellow
        }
    }

    if ($serviceUrls.ContainsKey('orchestrator')) {
        $moduleEnvUpdates = @()
        foreach ($moduleName in @('module1', 'module2', 'module3', 'module4')) {
            if ($serviceUrls.ContainsKey($moduleName)) {
                $moduleEnvUpdates += "{0}_SERVICE_URL={1}" -f $moduleName.ToUpper(), $serviceUrls[$moduleName]
            }
        }

        if ($moduleEnvUpdates.Count -gt 0) {
            $updateEnvArg = $moduleEnvUpdates -join ","
            Write-Host ""
            Write-Host "Updating orchestrator environment with module service URLs..." -ForegroundColor Cyan
            Write-Host "Command: gcloud run services update $orchestratorServiceName --region $deployRegion --update-env-vars=$updateEnvArg" -ForegroundColor Gray
            try {
                & gcloud run services update $orchestratorServiceName --region $deployRegion "--update-env-vars=$updateEnvArg"
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "Orchestrator environment updated." -ForegroundColor Green
                } else {
                    Write-Host "Failed to update orchestrator environment variables." -ForegroundColor Yellow
                }
            } catch {
                Write-Host "Error updating orchestrator environment: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
    }

    Write-Host ""
    Write-Host "Update frontend configuration:" -ForegroundColor Cyan
    Write-Host "Set NEXT_PUBLIC_API_URL to the orchestrator URL in your frontend deployment" -ForegroundColor White
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Gray
    Write-Host "gcloud run services update idkai-frontend --update-env-vars NEXT_PUBLIC_API_URL=https://idkai-backend-XXXX.run.app --region $deployRegion" -ForegroundColor Gray
}

if ($failedServices.Count -gt 0) {
    Write-Host ""
    Write-Host "Troubleshooting failed deployments:" -ForegroundColor Yellow
    Write-Host "1. Check build logs: gcloud builds list --limit 5" -ForegroundColor White
    Write-Host "2. View detailed logs: gcloud builds log BUILD_ID" -ForegroundColor White
    $failedKey = $failedServices[0]
    $failedServiceName = ($modules | Where-Object { $_.Key -eq $failedKey }).ServiceName
    if (-not $failedServiceName) { $failedServiceName = "<service-name>" }
    Write-Host "3. Check service logs: gcloud run services logs $failedServiceName --region $deployRegion" -ForegroundColor White
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
