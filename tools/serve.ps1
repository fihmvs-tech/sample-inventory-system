# 本機預覽用的靜態檔案伺服器（不需安裝 Node.js / Python）。
#   powershell -ExecutionPolicy Bypass -File tools/serve.ps1 [-Port 8080]
#   前端：http://localhost:8080/web/      測試：http://localhost:8080/tests/
# /web/js/demo/gas/<名稱>.js 會對應到 apps-script/<名稱>.gs，與 GitHub Pages 建置後的結構相同。
param([int]$Port = 8080)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.gs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.webmanifest' = 'application/manifest+json'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/web/  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($path -match '^/web/js/demo/gas/([A-Za-z]+)\.js$') {
        $file = Join-Path $root "apps-script\$($Matches[1]).gs"
      } else {
        $file = Join-Path $root ($path.TrimStart('/') -replace '/', '\')
        if (Test-Path -LiteralPath $file -PathType Container) { $file = Join-Path $file 'index.html' }
      }
      $full = [IO.Path]::GetFullPath($file)
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      } else {
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-store')
        $bytes = [IO.File]::ReadAllBytes($full)
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "$($res.StatusCode) $path"
    } catch {
      Write-Host "Error: $_"
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
