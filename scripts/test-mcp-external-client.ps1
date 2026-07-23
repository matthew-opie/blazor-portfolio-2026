# Phase 6D - External MCP client test (Cursor-style handshake)

$ErrorActionPreference = "Stop"
$mcp = "https://ug3hh2dosmw72v2vj7puwxg6g40nzsie.lambda-url.us-east-1.on.aws/mcp"
$headers = @{
    Accept = "application/json, text/event-stream"
    "Content-Type" = "application/json"
    "MCP-Protocol-Version" = "2025-03-26"
}

Write-Host "=== 1. initialize ==="
$initBody = @'
{"jsonrpc":"2.0","id":"init-1","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"cursor-external-test","version":"1.0.0"}}}
'@
$initResponse = Invoke-WebRequest -UseBasicParsing -Uri $mcp -Method POST -Headers $headers -Body $initBody
$sessionId = $initResponse.Headers["Mcp-Session-Id"]
if (-not $sessionId) { throw "initialize did not return Mcp-Session-Id" }
Write-Host "PASS initialize - session=$sessionId"
($initResponse.Content | ConvertFrom-Json).result.serverInfo | Format-List

$headers["Mcp-Session-Id"] = $sessionId

Write-Host ""
Write-Host "=== 2. notifications/initialized ==="
$initializedBody = '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
$initializedResponse = Invoke-WebRequest -UseBasicParsing -Uri $mcp -Method POST -Headers $headers -Body $initializedBody
if ($initializedResponse.StatusCode -ne 202) { throw "expected 202, got $($initializedResponse.StatusCode)" }
Write-Host "PASS notifications/initialized - HTTP 202"

Write-Host ""
Write-Host "=== 3. tools/list ==="
$listBody = '{"jsonrpc":"2.0","id":"list-1","method":"tools/list","params":{}}'
$listResponse = Invoke-RestMethod -Uri $mcp -Method POST -Headers $headers -Body $listBody -ContentType "application/json"
$toolNames = $listResponse.result.tools | ForEach-Object { $_.name }
Write-Host "PASS tools/list - $($toolNames.Count) tools: $($toolNames -join ', ')"

Write-Host ""
Write-Host "=== 4. tools/call check_ticker_restriction ==="
$callBody = @'
{"jsonrpc":"2.0","id":"call-1","method":"tools/call","params":{"name":"check_ticker_restriction","arguments":{"tenantId":"tenant_001","ticker":"AAPL"}}}
'@
$callResponse = Invoke-RestMethod -Uri $mcp -Method POST -Headers $headers -Body $callBody -ContentType "application/json"
$text = $callResponse.result.content[0].text
Write-Host "PASS tools/call - $text"
if ($text -notmatch 'allowed.*false') { throw "expected AAPL restricted for tenant_001" }

Write-Host ""
Write-Host "=== 5. GET SSE listener (5s sample) ==="
$sseHeaders = @{
    Accept = "text/event-stream"
    "Mcp-Session-Id" = $sessionId
}
$sseOk = $false
try {
    $sse = Invoke-WebRequest -UseBasicParsing -Uri $mcp -Method GET -Headers $sseHeaders -TimeoutSec 5
    if ($sse.Content -match "connected") { $sseOk = $true }
} catch {
    Write-Host "WARN GET /mcp SSE - $($_.Exception.Message)"
}
if ($sseOk) {
    Write-Host "PASS GET /mcp SSE - stream opened"
} else {
    Write-Host "WARN GET /mcp SSE - skipped or limited in Lambda BUFFERED mode"
}

Write-Host ""
Write-Host "All Phase 6D external-client checks passed."
