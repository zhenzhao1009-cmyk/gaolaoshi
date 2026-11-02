# Bloom - a tiny local web server for Windows.
# Uses only what ships with Windows 10/11 (PowerShell + .NET HttpListener); nothing to install.
# Started by START-Windows.bat. Close the window to stop.

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))  # the kit folder
$port = 8765
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".wasm" = "application/wasm"
  ".task" = "application/octet-stream"
  ".glb" = "model/gltf-binary"
  ".json" = "application/json"
  ".css"  = "text/css"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".txt"  = "text/plain; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "  Port $port is already in use."
  Write-Host "  Bloom may already be running in another window - close it and try again."
  Write-Host ""
  Read-Host "  Press Enter to exit"
  exit 1
}

Write-Host ""
Write-Host "  Bloom is running:  http://localhost:$port"
Write-Host "  Keep this window open while you play. Close it to stop."
Write-Host ""
Start-Process "http://localhost:$port/"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
    if ($rel -eq "") { $rel = "index.html" }
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
    } else {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch {}
  } finally {
    try { $res.Close() } catch {}
  }
}
