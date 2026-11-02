param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $PSScriptRoot 'serve.py'
$address = 'http://127.0.0.1:8765/'
try {
    $response = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200 -and $response.Content -match 'Bloom') {
        if (-not $NoBrowser) { Start-Process $address }
        exit 0
    }
} catch {}
$python = Get-Command pythonw.exe -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python.exe -ErrorAction SilentlyContinue }
if (-not $python) {
    & (Join-Path $PSScriptRoot 'serve.ps1')
    exit $LASTEXITCODE
}
$runtimeDir = Join-Path $env:TEMP 'bloom-gesture-kit-server'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$log = Join-Path $runtimeDir 'server.log'
$err = Join-Path $runtimeDir 'server-error.log'
$serverProcess = Start-Process -FilePath $python.Source -ArgumentList @('-u',('"' + $serverScript + '"'),'--port','8765') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
$serverProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeDir 'server.pid')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    try {
        $response = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -eq 200 -and $response.Content -match 'Bloom') {
            if (-not $NoBrowser) { Start-Process $address }
            exit 0
        }
    } catch {}
    if ($serverProcess.HasExited) { break }
}
Write-Host 'Bloom did not start. Details:'
if (Test-Path -LiteralPath $err) { Get-Content -LiteralPath $err }
exit 1
