#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy all backend modules to Cloud Run with rate limit handling
.DESCRIPTION
    Deploys orchestrator and all modules with delays to avoid Cloud Build rate limits
#>

param(
    [switch]$UseDefaults,
    [int]$DelaySeconds = 15
)

$ErrorActionPreference = "Stop"

$modules = @(
    @{ Name = "orchestrator"; Script = "deploy-orchestrator.ps1" },
    @{ Name = "module1"; Script = "deploy-module1.ps1" },
    @{ Name = "module2"; Script = "deploy-module2.ps1" },
    @{ Name = "module3"; Script = "deploy-module3.ps1" },
    @{ Name = "module4"; Script = "deploy-module4.ps1" }
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying All Modules to Cloud Run" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will deploy:" -ForegroundColor Yellow
foreach ($module in $modules) {
    Write-Host "  - $($module.Name)" -ForegroundColor White
}
Write-Host ""
Write-Host "Delay between deployments: $DelaySeconds seconds" -ForegroundColor Yellow
Write-Host ""

if (-not $UseDefaults) {
    $confirmation = Read-Host "Continue? (y/n)"
    if ($confirmation -ne "y") {
        Write-Host "Deployment cancelled" -ForegroundColor Red
        exit 0
    }
}

$deployedCount = 0
$failedCount = 0
$failedModules = @()

foreach ($module in $modules) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Deploying $($module.Name)..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    try {
        if ($UseDefaults) {
            & ".\$($module.Script)" -UseDefaults
        } else {
            & ".\$($module.Script)"
        }
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ $($module.Name) deployed successfully" -ForegroundColor Green
            $deployedCount++
        } else {
            Write-Host "✗ $($module.Name) deployment failed with exit code $LASTEXITCODE" -ForegroundColor Red
            $failedCount++
            $failedModules += $module.Name
        }
    } catch {
        Write-Host "✗ $($module.Name) deployment failed: $_" -ForegroundColor Red
        $failedCount++
        $failedModules += $module.Name
    }
    
    # Delay before next deployment (except after last module)
    if ($module -ne $modules[-1]) {
        Write-Host ""
        Write-Host "Waiting $DelaySeconds seconds before next deployment (rate limit protection)..." -ForegroundColor Yellow
        Start-Sleep -Seconds $DelaySeconds
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Successful: $deployedCount" -ForegroundColor Green
Write-Host "Failed: $failedCount" -ForegroundColor $(if ($failedCount -eq 0) { "Green" } else { "Red" })

if ($failedCount -gt 0) {
    Write-Host ""
    Write-Host "Failed modules:" -ForegroundColor Red
    foreach ($failed in $failedModules) {
        Write-Host "  - $failed" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "All modules deployed successfully! 🚀" -ForegroundColor Green
