# Onboarding Platform — Golden Tests & v1 Baseline

Frozen regression targets for v2 work. Re-run the PowerShell script below before major changes.

**Function URL:** `https://wpxmrqqplaszo4vgsihtvccmei0dbzao.lambda-url.us-east-1.on.aws`  
**Baseline captured:** 2026-07-23  
**AWS account:** `019025076504`

---

## Expected answers

| Tenant | Question | Expected fact |
|--------|----------|---------------|
| `tenant_001` | Max position size? | **4.0%** (RULE-CONC-02) |
| `tenant_002` | Max position size? | **3.5%** (RULE-CONC-02) |
| `tenant_001` | Is AAPL restricted? | **Yes** — Side Letter restricted ticker list |
| `tenant_002` | Is BABA restricted? | **Yes** (verify when adding tests) |

---

## Golden test script (PowerShell)

Run from repo root before a portfolio push:

```powershell
.\scripts\run-golden-tests.ps1
# optional override:
.\scripts\run-golden-tests.ps1 -BaseUrl "https://wpxmrqqplaszo4vgsihtvccmei0dbzao.lambda-url.us-east-1.on.aws"
```

Inline reference (same checks):
$base = "https://wpxmrqqplaszo4vgsihtvccmei0dbzao.lambda-url.us-east-1.on.aws"
$fail = 0

# Health
$h = Invoke-RestMethod "$base/health"
if (-not $h.success) { Write-Host "FAIL health"; $fail++ } else { Write-Host "PASS health" }

# Tenants (expect 10)
$count = (Invoke-RestMethod "$base/tenants").tenants.Count
if ($count -ne 10) { Write-Host "FAIL tenants count=$count"; $fail++ } else { Write-Host "PASS tenants=10" }

# tenant_001 cap
$body = '{"query":"What is the maximum position size for a single security?"}'
$r1 = Invoke-RestMethod "$base/tenants/tenant_001/query" -Method POST -Body $body -ContentType "application/json"
if ($r1.message -notmatch "4\.0|4\.0%") { Write-Host "FAIL tenant_001 cap: $($r1.message)"; $fail++ } else { Write-Host "PASS tenant_001 cap" }

# tenant_002 cap
$r2 = Invoke-RestMethod "$base/tenants/tenant_002/query" -Method POST -Body $body -ContentType "application/json"
if ($r2.message -notmatch "3\.5|3\.5%") { Write-Host "FAIL tenant_002 cap: $($r2.message)"; $fail++ } else { Write-Host "PASS tenant_002 cap" }

# tenant_001 AAPL
$body2 = '{"query":"Is AAPL a restricted ticker?"}'
$r3 = Invoke-RestMethod "$base/tenants/tenant_001/query" -Method POST -Body $body2 -ContentType "application/json"
if ($r3.message -notmatch "restrict|prohibit|exclud|not permitted|AAPL") {
  Write-Host "FAIL tenant_001 AAPL: $($r3.message)"; $fail++
} else { Write-Host "PASS tenant_001 AAPL" }

if ($fail -gt 0) { exit 1 } else { Write-Host "All golden tests passed."; exit 0 }
```

---

## Baseline run results (2026-07-23)

| Check | Result |
|-------|--------|
| `GET /health` | PASS — `success: true`, "Configuration loaded." |
| `GET /tenants` | PASS — **10** tenants |
| `tenant_001` position cap | PASS — "4.0% … RULE-CONC-02" |
| `tenant_002` position cap | PASS — "3.5% … RULE-CONC-02" |
| `tenant_001` AAPL restricted | PASS — "Yes, AAPL … restricted ticker … Side Letter" |

**Sample snippets (2026-07-23):**

- tenant_001 cap: *"The maximum position size for a single security is 4.0% of total portfolio market value at cost basis (RULE-CONC-02 Position Limit)."*
- tenant_002 cap: *"The maximum position size for a single security is capped at 3.5% at cost basis across all asset classes (RULE-CONC-02)."*
- tenant_001 AAPL: *"Yes, AAPL (Apple Inc.) is a restricted ticker as stated in Section 1 of the Side Letter under the Custom Restricted Ticker List."*

---

## Baseline snapshot (infra names only)

| Resource | Value |
|----------|-------|
| Lambda function | `ClientOnboardingLambda` |
| DynamoDB table | `OnboardingPlatform` |
| DynamoDB item count | **250** (2026-07-23 scan) |
| S3 seed bucket | `onboarding-seed-019025076504` |
| Qdrant collections | `tenant_001` … `tenant_010` |
| Blazor config | `wwwroot/appsettings.json` → `OnboardingApi:BaseUrl` |

**Lambda environment variable names** (values not recorded here):

- `OPENAI_API_KEY`
- `QDRANT_URL`
- `QDRANT_API_KEY`
- `DYNAMODB_TABLE_NAME`
- `SEED_BUCKET_NAME`
- `ADMIN_API_KEY`
- `MCP_SERVER_URL` (optional — omit for in-process tool fallback)
- `MCP_SERVER_API_KEY` (optional — sent as `x-api-key` to MCP server)

---

## Portfolio site check

| Check | Result |
|-------|--------|
| `wwwroot/appsettings.json` in repo | Function URL configured |
| `https://www.mattopie.com/appsettings.json` (deployed) | PASS — contains Function URL |
| `https://www.mattopie.com/onboarding` | **403** from automated HTTP check (2026-07-23) — verify in browser; may be Cloudflare/WAF or routing rule |

---

## Phase 0 checkpoint

- [x] Golden tests pass against Function URL
- [x] This file created at `docs/onboarding-golden-tests.md`
- [ ] Live site `/onboarding` — deployed appsettings OK; `/onboarding` returned 403 to automated probe (confirm in browser)

---

## Phase 1 — Structured logging (2026-07-23)

Lambda now emits JSON log lines per stage and returns `x-request-id` on every response.

**Example CloudWatch Logs Insights filter:**

```
fields @timestamp, @message
| filter @message like /phase1-test-001/
| sort @timestamp asc
```

**Stages logged on query:** `request_received` → `retrieval` → `mcp_tools` → `openai_synthesis` → `query_complete` → `request_complete`

**CORS** (Function URL): `https://mattopie.com`, `https://www.mattopie.com`, `http://localhost:5000`, `http://localhost:5201`, `http://localhost:5156`
