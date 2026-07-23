param(
    [string]$BaseUrl = "https://wpxmrqqplaszo4vgsihtvccmei0dbzao.lambda-url.us-east-1.on.aws"
)

$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
$fail = 0

function Assert-Pass([string]$Name, [bool]$Condition, [string]$Detail = "") {
    if ($Condition) {
        Write-Host "PASS $Name"
    } else {
        Write-Host "FAIL $Name${Detail}"
        $script:fail++
    }
}

Write-Host "Running golden tests against $base"
Write-Host ""

try {
    $health = Invoke-RestMethod "$base/health"
    Assert-Pass "health" ($health.success -eq $true)
} catch {
    Assert-Pass "health" $false " ($($_.Exception.Message))"
}

try {
    $tenantCount = (Invoke-RestMethod "$base/tenants").tenants.Count
    Assert-Pass "tenants=10" ($tenantCount -eq 10) " (count=$tenantCount)"
} catch {
    Assert-Pass "tenants=10" $false " ($($_.Exception.Message))"
}

$capBody = '{"query":"What is the maximum position size for a single security?"}'
try {
    $r1 = Invoke-RestMethod "$base/tenants/tenant_001/query" -Method POST -Body $capBody -ContentType "application/json"
    Assert-Pass "tenant_001 cap" ($r1.message -match "4\.0|4\.0%")
} catch {
    Assert-Pass "tenant_001 cap" $false " ($($_.Exception.Message))"
}

try {
    $r2 = Invoke-RestMethod "$base/tenants/tenant_002/query" -Method POST -Body $capBody -ContentType "application/json"
    Assert-Pass "tenant_002 cap" ($r2.message -match "3\.5|3\.5%")
} catch {
    Assert-Pass "tenant_002 cap" $false " ($($_.Exception.Message))"
}

$aaplBody = '{"query":"Is AAPL a restricted ticker?"}'
try {
    $r3 = Invoke-RestMethod "$base/tenants/tenant_001/query" -Method POST -Body $aaplBody -ContentType "application/json"
    Assert-Pass "tenant_001 AAPL" ($r3.message -match "restrict|prohibit|exclud|not permitted|AAPL")
} catch {
    Assert-Pass "tenant_001 AAPL" $false " ($($_.Exception.Message))"
}

$babaBody = '{"query":"Is BABA a restricted ticker?"}'
try {
    $r4 = Invoke-RestMethod "$base/tenants/tenant_002/query" -Method POST -Body $babaBody -ContentType "application/json"
    Assert-Pass "tenant_002 BABA" ($r4.message -match "restrict|prohibit|exclud|not permitted|BABA")
} catch {
    Assert-Pass "tenant_002 BABA" $false " ($($_.Exception.Message))"
}

Write-Host ""
if ($fail -gt 0) {
    Write-Host "$fail golden test(s) failed."
    exit 1
}

Write-Host "All golden tests passed."
exit 0
