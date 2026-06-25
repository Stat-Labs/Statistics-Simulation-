# StatLab API Test Script (PowerShell 5.1 compatible)
# Run the dev server first:  npm run dev
# Then:  powershell -File test-api.ps1

$baseUrl = "http://localhost:3000/api"
$csvPath = "C:\statslab\test-data.csv"

Write-Host "=== StatLab API Test ===" -ForegroundColor Cyan

# Build schema (what the frontend would extract via DanfoJS client-side)
$schema = @{
    fileName = "test-data.csv"
    rowCount = 10
    columnCount = 5
    columns = @(
        @{ name = "name";   type = "categorical"; uniqueValues = @("Alice","Bob","Charlie"); nullCount = 0 }
        @{ name = "age";    type = "continuous";  min = 19; max = 40; nullCount = 0 }
        @{ name = "score";  type = "continuous";  min = 55; max = 96; nullCount = 0 }
        @{ name = "passed"; type = "binary";      uniqueValues = @(0, 1); nullCount = 0 }
        @{ name = "gender"; type = "binary";      uniqueValues = @("F","M"); nullCount = 0 }
    )
    sampleRows = @(
        @{ name = "Alice";  age = "25"; score = "88"; passed = "1"; gender = "F" }
        @{ name = "Bob";    age = "30"; score = "72"; passed = "0"; gender = "M" }
        @{ name = "Charlie";age = "22"; score = "95"; passed = "1"; gender = "M" }
    )
}

# ─────────────────────────────────────────────
# 1. POST /api/profile  (AI profiler — needs API key)
# ─────────────────────────────────────────────
Write-Host "`n[1/3] POST /api/profile" -ForegroundColor Yellow
Write-Host "  Sends schema -> AI recommends analyses + charts"
Write-Host "  (Requires GROQ_API_KEY in .env.local)" -ForegroundColor Gray

try {
    $jsonBody = $schema | ConvertTo-Json -Depth 10
    $profilerResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/profile" `
        -Body $jsonBody -ContentType "application/json" -ErrorAction Stop
    Write-Host "  ✓ Success" -ForegroundColor Green
    Write-Host "  Model:" $profilerResp.output.analysisMap.modelType
    Write-Host "  Charts:" $profilerResp.output.chartSuggestions.Count
} catch {
    Write-Host "  ✗ $($_.Exception.Message)" -ForegroundColor Red
}

# ─────────────────────────────────────────────
# 2. POST /api/analyse  (computation — no AI)
# ─────────────────────────────────────────────
Write-Host "`n[2/3] POST /api/analyse" -ForegroundColor Yellow
Write-Host "  Sends CSV + analysis request -> computed statistics"
Write-Host "  (Pure math — no API keys needed)" -ForegroundColor Gray

$analysisRequest = @{
    mode = "manual"
    descriptive = @{ columns = @("age", "score"); measures = @("central", "spread", "distribution") }
    inferential = @{
        correlationPairs = @(, @("age", "score"))
        hypothesisTests = @(@{ type = "t-test"; columns = @("score", "gender") })
    }
    predictive = @{ dependent = "score"; predictors = @("age"); modelType = "linear" }
}

try {
    $client = New-Object System.Net.Http.HttpClient
    $formContent = New-Object System.Net.Http.MultipartFormDataContent

    $fileBytes = [System.IO.File]::ReadAllBytes($csvPath)
    $fileContent = New-Object System.Net.Http.ByteArrayContent($fileBytes, 0, $fileBytes.Length)
    $fileContent.Headers.ContentDisposition = New-Object System.Net.Http.Headers.ContentDispositionHeaderValue("form-data")
    $fileContent.Headers.ContentDisposition.Name = "file"
    $fileContent.Headers.ContentDisposition.FileName = "test-data.csv"
    $formContent.Add($fileContent)

    $analysesJson = $analysisRequest | ConvertTo-Json -Compress -Depth 10
    $analysesContent = New-Object System.Net.Http.StringContent($analysesJson)
    $analysesContent.Headers.ContentDisposition = New-Object System.Net.Http.Headers.ContentDispositionHeaderValue("form-data")
    $analysesContent.Headers.ContentDisposition.Name = "analyses"
    $formContent.Add($analysesContent)

    $response = $client.PostAsync("$baseUrl/analyse", $formContent).Result
    $responseText = $response.Content.ReadAsStringAsync().Result
    $analyseResp = $responseText | ConvertFrom-Json

    if ($response.IsSuccessStatusCode) {
        Write-Host "  ✓ Success" -ForegroundColor Green
        Write-Host "  Descriptive:" $analyseResp.result.descriptive.Count "columns"
        Write-Host "  Correlations:" $analyseResp.result.inferential.correlations.Count
        Write-Host "  T-Tests:" $analyseResp.result.inferential.hypothesisTests.Count
        Write-Host "  Regression:" $analyseResp.result.predictive.modelType "- R² =" $analyseResp.result.predictive.regressionResult.rSquared
        Write-Host "  Missing values:" $analyseResp.missingValueReport.totalMissing
        Write-Host "  Rows:" $analyseResp.schema.rowCount
    } else {
        Write-Host "  ✗ $($analyseResp.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ $($_.Exception.Message)" -ForegroundColor Red
}

# ─────────────────────────────────────────────
# 3. POST /api/interpret  (AI interpretation — needs API key)
# ─────────────────────────────────────────────
Write-Host "`n[3/3] POST /api/interpret" -ForegroundColor Yellow
Write-Host "  Sends schema + computed results -> plain-English explanation"
Write-Host "  (Requires GROQ_API_KEY in .env.local)" -ForegroundColor Gray

if ($analyseResp -and $response.IsSuccessStatusCode) {
    try {
        $interpretBody = @{ schema = $schema; result = $analyseResp.result }
        $jsonBody = $interpretBody | ConvertTo-Json -Depth 10
        $interpretResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/interpret" `
            -Body $jsonBody -ContentType "application/json" -ErrorAction Stop
        Write-Host "  ✓ Success" -ForegroundColor Green
        Write-Host "  Summary:" $interpretResp.summary
        Write-Host "  Provider:" $interpretResp.provider
        Write-Host "  Fallback:" $interpretResp.fallbackUsed
        foreach ($item in $interpretResp.perAnalysis) {
            Write-Host "    [$($item.type)] $($item.subject): $($item.interpretation)"
        }
    } catch {
        Write-Host "  ✗ $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
