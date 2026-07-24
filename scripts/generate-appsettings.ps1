# Generates wwwroot/appsettings.json from repo-root .env for local Blazor WASM dev.
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env"),
    [string]$OutputFile = (Join-Path $PSScriptRoot "..\wwwroot\appsettings.json")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFile)) {
    Write-Error @"
.env not found at $EnvFile

Copy .env.example to .env and set ONBOARDING_API_BASE_URL:
  Copy-Item .env.example .env
"@
}

$variables = @{}
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
        return
    }

    $parts = $line -split "=", 2
    if ($parts.Count -ne 2) {
        return
    }

    $key = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    $variables[$key] = $value
}

$baseUrl = $variables["ONBOARDING_API_BASE_URL"]
if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    Write-Error "ONBOARDING_API_BASE_URL is missing or empty in $EnvFile"
}

$payload = @{
    OnboardingApi = @{
        BaseUrl = $baseUrl.TrimEnd("/")
    }
}

$json = $payload | ConvertTo-Json -Depth 3
Set-Content -Path $OutputFile -Value $json -Encoding UTF8
Write-Host "Wrote $OutputFile"
