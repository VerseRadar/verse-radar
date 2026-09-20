$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot "public"
$prefix = "http://localhost:8000/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "Der lokale Server konnte nicht gestartet werden." -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
    Read-Host "Enter zum Beenden"
    exit 1
}

Start-Process $prefix
Write-Host "Verse Radar laeuft unter $prefix"
Write-Host "Dieses Fenster offen lassen. Zum Beenden Ctrl+C druecken."
Write-Host ""

$mime = @{
    ".html"="text/html; charset=utf-8"
    ".css"="text/css; charset=utf-8"
    ".js"="application/javascript; charset=utf-8"
    ".json"="application/json; charset=utf-8"
    ".png"="image/png"
    ".jpg"="image/jpeg"
    ".jpeg"="image/jpeg"
    ".svg"="image/svg+xml"
    ".ico"="image/x-icon"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)

        if ($path -eq "/") { $path = "/index.html" }

        # Prevent path traversal
        $relative = $path.TrimStart("/").Replace("/", "\")
        $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
        $rootFull = [IO.Path]::GetFullPath($root)

        if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
            $context.Response.StatusCode = 403
            $context.Response.Close()
            continue
        }

        if (Test-Path $full -PathType Leaf) {
            $bytes = [IO.File]::ReadAllBytes($full)
            $ext = [IO.Path]::GetExtension($full).ToLower()
            if ($mime.ContainsKey($ext)) {
                $context.Response.ContentType = $mime[$ext]
            } else {
                $context.Response.ContentType = "application/octet-stream"
            }
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $context.Response.StatusCode = 404
            $bytes = [Text.Encoding]::UTF8.GetBytes("404 - Datei nicht gefunden")
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        $context.Response.Close()
    } catch {
        # Continue serving requests unless the listener is stopped.
    }
}
