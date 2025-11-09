#!/usr/bin/env pwsh
param(
    [switch]$UseDefaults
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'scripts/deploy-module.ps1')

Invoke-ModuleDeployment -ModuleKey 'module1' -UseDefaults:$UseDefaults
