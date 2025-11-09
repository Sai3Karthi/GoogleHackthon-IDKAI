function Get-DeployModuleRepoRoot {
    param()
    return (Split-Path -Parent $PSScriptRoot)
}

$script:DeployModuleRepoRoot = Get-DeployModuleRepoRoot
$script:DeployModuleEnvPath = Join-Path $script:DeployModuleRepoRoot '.env'
$script:DeployModuleEnvCache = $null

function Test-GcloudCli {
    if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
        Write-Host 'Google Cloud CLI not found. Install from https://cloud.google.com/sdk/docs/install' -ForegroundColor Red
        throw 'gcloud CLI missing'
    }
}

function Get-RepoEnvValue {
    param([string]$Key)
    if ([string]::IsNullOrWhiteSpace($Key)) {
        return $null
    }
    $existing = [Environment]::GetEnvironmentVariable($Key)
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
        return $existing
    }
    if ($null -eq $script:DeployModuleEnvCache) {
        $script:DeployModuleEnvCache = @{}
        if (Test-Path $script:DeployModuleEnvPath) {
            Get-Content $script:DeployModuleEnvPath | ForEach-Object {
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
                    $script:DeployModuleEnvCache[$k] = $v
                }
            }
        }
    }
    if ($script:DeployModuleEnvCache.ContainsKey($Key)) {
        return $script:DeployModuleEnvCache[$Key]
    }
    return $null
}

function ConvertTo-SecretValue {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }
    $parts = $Value.Split('=', 2)
    if ($parts.Length -eq 2) {
        return $parts[1]
    }
    return $Value
}

function Read-ValueWithDefault {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][string]$Key,
        [switch]$Required,
        [switch]$Normalize,
        [string]$FallbackValue,
        [switch]$UseDefaults
    )

    $default = Get-RepoEnvValue $Key
    if (-not $default -and $FallbackValue) {
        $default = $FallbackValue
    }

    if ($UseDefaults -and $default) {
        return $default.Trim()
    }

    $message = if ($default) { "$Prompt (Press Enter to reuse saved value)" } else { $Prompt }
    $userInput = Read-Host $message
    $value = if ($userInput) { $userInput } else { $default }

    if ($value) {
        $value = $value.Trim()
    }

    if ($Normalize -and $value) {
        $value = ConvertTo-SecretValue $value
    }

    if ($Required -and [string]::IsNullOrWhiteSpace($value)) {
        Write-Host "$Key is required." -ForegroundColor Red
        throw "$Key missing"
    }

    return $value
}

function Get-ModuleMetadata {
    $modules = @{
        module1 = @{
            ServiceName = 'idkai-module1'
            ImageName = 'idkai-module1'
            Dockerfile = 'module1/backend/Dockerfile'
            Port = 8001
            Description = 'Module 1 - Link Verification & Scam Detection'
        }
        module2 = @{
            ServiceName = 'idkai-module2'
            ImageName = 'idkai-module2'
            Dockerfile = 'Module2/backend/Dockerfile'
            Port = 8002
            Description = 'Module 2 - Classification & Scoring'
        }
        module3 = @{
            ServiceName = 'idkai-module3'
            ImageName = 'idkai-module3'
            Dockerfile = 'module3/backend/Dockerfile'
            Port = 8003
            Description = 'Module 3 - Perspective Generation'
        }
        module4 = @{
            ServiceName = 'idkai-module4'
            ImageName = 'idkai-module4'
            Dockerfile = 'module4/backend/Dockerfile'
            Port = 8004
            Description = 'Module 4 - Agent Debate & Analysis'
        }
    }
    return $modules
}

function New-CloudBuildConfig {
    param(
        [Parameter(Mandatory = $true)][string]$Dockerfile,
        [Parameter(Mandatory = $true)][string]$ImageTag
    )
    $content = @"
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-f', '$Dockerfile', '-t', '$ImageTag', '.']
images:
- '$ImageTag'
"@
    $tempFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tempFile -Value $content -Encoding UTF8
    return $tempFile
}

function Invoke-ModuleDeployment {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('module1', 'module2', 'module3', 'module4')][string]$ModuleKey,
        [switch]$UseDefaults
    )

    Test-GcloudCli
    $projectId = gcloud config get-value project 2>$null
    if (-not $projectId) {
        Write-Host 'No Google Cloud project configured. Run: gcloud config set project YOUR_PROJECT_ID' -ForegroundColor Red
        throw 'project missing'
    }
    Write-Host "Project: $projectId" -ForegroundColor Cyan

    $modules = Get-ModuleMetadata
    if (-not $modules.ContainsKey($ModuleKey)) {
        Write-Host "Unknown module: $ModuleKey" -ForegroundColor Red
        throw 'invalid module'
    }
    $module = $modules[$ModuleKey]

    $moduleDescription = $module.Description
    Write-Host "Deploying $ModuleKey ($moduleDescription)" -ForegroundColor Cyan

    $module4ConfigPath = Join-Path $script:DeployModuleRepoRoot 'module4/backend/config.json'
    $module4DefaultSearchId = $null
    if ($ModuleKey -eq 'module4' -or (-not (Get-RepoEnvValue 'SEARCH_ENGINE_ID'))) {
        if (Test-Path $module4ConfigPath) {
            try {
                $module4Config = Get-Content $module4ConfigPath -Raw | ConvertFrom-Json
                if ($module4Config.search_engine_id) {
                    $module4DefaultSearchId = [string]$module4Config.search_engine_id
                }
            } catch {
                Write-Host 'Unable to read module4/backend/config.json for search engine defaults.' -ForegroundColor DarkYellow
            }
        }
    }

    $geminiApiKey = Read-ValueWithDefault -Prompt 'Enter your Google Gemini API key' -Key 'GEMINI_API_KEY' -Required -Normalize -UseDefaults:$UseDefaults
    $databaseUrl = Read-ValueWithDefault -Prompt 'Enter DATABASE_URL for the shared Postgres instance' -Key 'DATABASE_URL' -Required -UseDefaults:$UseDefaults
    $vertexEndpoint = Read-ValueWithDefault -Prompt 'Enter Vertex AI endpoint path for Module 3 (VERTEX_ENDPOINT)' -Key 'VERTEX_ENDPOINT' -Required -UseDefaults:$UseDefaults

    $googleApiKey = Read-ValueWithDefault -Prompt 'Enter your Google API key (optional)' -Key 'GOOGLE_API_KEY' -Normalize -UseDefaults:$UseDefaults
    if (-not $googleApiKey) {
        $googleApiKey = $geminiApiKey
        Write-Host 'Using GEMINI_API_KEY for Google API calls.' -ForegroundColor Yellow
    }

    $webSearchKey = Read-ValueWithDefault -Prompt 'Enter Web Search API key (optional)' -Key 'WEB_SEARCH_API_KEY' -Normalize -UseDefaults:$UseDefaults
    if (-not $webSearchKey -and $googleApiKey) {
        $webSearchKey = $googleApiKey
        Write-Host 'Using Google API key as WEB_SEARCH_API_KEY.' -ForegroundColor Yellow
    }

    $searchEngineId = Read-ValueWithDefault -Prompt 'Enter Custom Search Engine ID (optional)' -Key 'SEARCH_ENGINE_ID' -Normalize -FallbackValue $module4DefaultSearchId -UseDefaults:$UseDefaults

    $defaultRegion = Get-RepoEnvValue 'GCLOUD_REGION'
    if (-not $defaultRegion) {
        $defaultRegion = 'asia-south1'
    }
    $deployRegion = Read-ValueWithDefault -Prompt 'Enter Cloud Run region' -Key 'GCLOUD_REGION' -Required -FallbackValue $defaultRegion -UseDefaults:$UseDefaults
    Write-Host "Region: $deployRegion" -ForegroundColor Cyan

    $defaultBackendUrl = 'https://idkai-backend-454838348123.asia-south1.run.app'
    $deployedBackendUrl = Read-ValueWithDefault -Prompt 'Enter deployed orchestrator URL' -Key 'ORCHESTRATOR_SERVICE_URL' -FallbackValue $defaultBackendUrl -UseDefaults:$UseDefaults
    if (-not $deployedBackendUrl) {
        $deployedBackendUrl = $defaultBackendUrl
    }

    $defaultFrontendUrl = 'https://idkai-frontend-454838348123.asia-south1.run.app'
    $deployedFrontendUrl = Read-ValueWithDefault -Prompt 'Enter deployed frontend URL' -Key 'FRONTEND_SERVICE_URL' -FallbackValue $defaultFrontendUrl -UseDefaults:$UseDefaults
    if (-not $deployedFrontendUrl) {
        $deployedFrontendUrl = $defaultFrontendUrl
    }

    $envVars = @(
        "GEMINI_API_KEY=$geminiApiKey",
        "DATABASE_URL=$databaseUrl",
        "VERTEX_ENDPOINT=$vertexEndpoint",
        "DEPLOYED_BACKEND_URL=$deployedBackendUrl",
        "DEPLOYED_FRONTEND_URL=$deployedFrontendUrl",
        "ORCHESTRATOR_SERVICE_URL=$deployedBackendUrl",
        "FRONTEND_SERVICE_URL=$deployedFrontendUrl"
    )
    if ($googleApiKey) { $envVars += "GOOGLE_API_KEY=$googleApiKey" }
    if ($webSearchKey) { $envVars += "WEB_SEARCH_API_KEY=$webSearchKey" }
    if ($searchEngineId) { $envVars += "SEARCH_ENGINE_ID=$searchEngineId" }

    $envVarArgs = $envVars | ForEach-Object { "--set-env-vars=$_" }

    $imageTag = "gcr.io/$projectId/$($module.ImageName):latest"
    $cloudBuildConfig = New-CloudBuildConfig -Dockerfile $module.Dockerfile -ImageTag $imageTag
    Write-Host "Building image: $imageTag" -ForegroundColor Cyan

    try {
        & gcloud builds submit --config $cloudBuildConfig $script:DeployModuleRepoRoot
        if ($LASTEXITCODE -ne 0) {
            throw 'Cloud Build failed'
        }
    } catch {
        Remove-Item -Path $cloudBuildConfig -ErrorAction SilentlyContinue
        Write-Host "Build error: $($_.Exception.Message)" -ForegroundColor Red
        throw
    }

    Remove-Item -Path $cloudBuildConfig -ErrorAction SilentlyContinue

    $deployArgs = @(
        'run','deploy',$module.ServiceName,
        '--image',$imageTag,
        '--platform','managed',
        '--region',$deployRegion,
        '--allow-unauthenticated',
        '--port',[string]$module.Port,
        '--memory','1Gi',
        '--cpu','1',
        '--max-instances','5',
        '--timeout','900'
    )
    $deployArgs += $envVarArgs

    Write-Host "Deploying service $($module.ServiceName)" -ForegroundColor Cyan
    & gcloud @deployArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Deployment failed.' -ForegroundColor Red
        throw 'Cloud Run deploy failed'
    }

    $serviceUrl = $null
    try {
        $serviceUrl = & gcloud run services describe $module.ServiceName --region $deployRegion --format='value(status.url)'
    } catch {
        Write-Host 'Unable to fetch service URL.' -ForegroundColor Yellow
    }

    if ($serviceUrl) {
        Write-Host "Service URL: $serviceUrl" -ForegroundColor Green
        $orchestratorService = 'idkai-backend'
        $envUpdateValue = '{0}_SERVICE_URL={1}' -f $ModuleKey.ToUpper(), $serviceUrl
        try {
            & gcloud run services update $orchestratorService --region $deployRegion "--update-env-vars=$envUpdateValue" 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host 'Orchestrator environment updated with module URL.' -ForegroundColor Green
            } else {
                Write-Host 'Orchestrator env update skipped (non-zero exit).' -ForegroundColor DarkYellow
            }
        } catch {
            Write-Host 'Failed to update orchestrator service environment.' -ForegroundColor Yellow
        }
    }

    Write-Host "Deployment completed for $ModuleKey." -ForegroundColor Green
}
