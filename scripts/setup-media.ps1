# setup-media.ps1 - Download and install ffmpeg / whisper.cpp / models into the DATA ROOT (domestic mirrors first)
# Usage: Set-ExecutionPolicy -Scope Process Bypass -Force; & scripts\setup-media.ps1
# Data root: $env:BILI_DATA_ROOT when set (plugin layout, e.g. %USERPROFILE%\.dsh\bili-sum), else the package dir (legacy layout).
# Re-run safe: existing artifacts above the size threshold are skipped.
$ErrorActionPreference = 'Continue'
$pkgRoot = Split-Path -Parent $PSScriptRoot
$dataRoot = if ($env:BILI_DATA_ROOT -and $env:BILI_DATA_ROOT.Trim()) { $env:BILI_DATA_ROOT.Trim() } else { $pkgRoot }
$tools = Join-Path $dataRoot 'tools'
Write-Host "package root : $pkgRoot"
Write-Host "data root    : $dataRoot"
New-Item -ItemType Directory -Force -Path $tools, "$tools\ffmpeg", "$tools\whisper", "$tools\models", (Join-Path $dataRoot 'bin') | Out-Null

function Try-Dl([string]$url, [string]$out, [int]$minMB) {
  $minBytes = if ($minMB -le 0) { 1KB } else { $minMB * 1MB }
  if ((Test-Path $out) -and ((Get-Item $out).Length -gt $minBytes)) { Write-Host "SKIP (exists) $out"; return $true }
  Write-Host ">> GET $url"
  & node (Join-Path $pkgRoot 'scripts\dl.mjs') $url $out $minMB
  return ($LASTEXITCODE -eq 0)
}

Write-Host "=== 1) ffmpeg (single exe preferred) ==="
$ffexe = "$tools\ffmpeg\ffmpeg.exe"
$ok = (Test-Path $ffexe) -and ((Get-Item $ffexe).Length -gt 30MB)
if (-not $ok) { $ok = Try-Dl "https://cdn.npmmirror.com/binaries/ffmpeg-static/b6.0/ffmpeg-win32-x64" $ffexe 30 }
if (-not $ok) { $ok = Try-Dl "https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.0/ffmpeg-win32-x64" $ffexe 30 }
if (-not $ok) { $ok = Try-Dl "https://registry.npmmirror.com/-/binary/ffmpeg-static/b4.0/ffmpeg-win32-x64" $ffexe 25 }
if (-not $ok) {
  $ffzip = "$tools\ffmpeg.zip"
  $ok = Try-Dl "https://ghfast.top/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" $ffzip 80
  if ($ok) {
    Expand-Archive -Path $ffzip -DestinationPath "$tools\ffmpeg" -Force
    $found = Get-ChildItem "$tools\ffmpeg" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { Copy-Item $found.FullName $ffexe -Force }
  }
}
if ((Test-Path $ffexe) -and ((Get-Item $ffexe).Length -gt 10MB)) { Write-Host "ffmpeg OK: $ffexe"; & $ffexe -version 2>&1 | Select-Object -First 1 } else { Write-Host "ffmpeg FAILED" }

Write-Host "=== 2) whisper.cpp v1.9.2 cpu blas build ==="
$wzip = "$tools\whisper-bin.zip"
# Note: official Windows binaries stop at v1.9.2; v1.9.4+ ships no Windows assets
$ok = Try-Dl "https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-blas-bin-x64.zip" $wzip 15
if (-not $ok) { $ok = Try-Dl "https://ghfast.top/https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-blas-bin-x64.zip" $wzip 15 }
if (-not $ok) { $ok = Try-Dl "https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip" $wzip 6 }
if ($ok) { Expand-Archive -Path $wzip -DestinationPath "$tools\whisper" -Force }
$wcli = Get-ChildItem "$tools\whisper" -Recurse -Include whisper-cli.exe, main.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($wcli) { Write-Host "whisper-cli OK: $($wcli.FullName)" } else { Write-Host "whisper-cli FAILED" }

Write-Host "=== 3) model ggml-small.bin (Chinese) ==="
$ok = Try-Dl "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" "$tools\models\ggml-small.bin" 400
if (-not $ok) { $ok = Try-Dl "https://hf-mirror.com/ggml-org/whisper.cpp/resolve/main/ggml-small.bin" "$tools\models\ggml-small.bin" 400 }
if (-not $ok) { Write-Host "small FAILED, trying base"; $ok = Try-Dl "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin" "$tools\models\ggml-base.bin" 120 }
if (-not $ok) { Write-Host "model FAILED" }

Write-Host "=== 4) silero VAD model (optional; VAD auto-off when missing) ==="
# Canonical source: whisper.cpp moved VAD models to the dedicated ggml-org/whisper-vad repo
# (see models/download-vad-model.sh upstream); old ggerganov/whisper.cpp paths now 404.
$ok = Try-Dl "https://hf-mirror.com/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin" "$tools\models\ggml-silero-v6.2.0.bin" 0
if (-not $ok) { $ok = Try-Dl "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin" "$tools\models\ggml-silero-v6.2.0.bin" 0 }
if (-not $ok) { $ok = Try-Dl "https://hf-mirror.com/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin" "$tools\models\ggml-silero-v5.1.2.bin" 0 }
if ($ok) { Write-Host "silero VAD OK" } else { Write-Host "silero VAD skipped/FAILED (pipeline still works; VAD will be off)" }

Write-Host "=== 5) yt-dlp.exe into data-root bin/ ==="
& node (Join-Path $pkgRoot 'scripts\fetch-ytdlp.mjs')
if ($LASTEXITCODE -eq 0) { Write-Host "yt-dlp OK" } else { Write-Host "yt-dlp FAILED (playurl fallback still works)" }

Write-Host "=== summary ($dataRoot) ==="
Get-ChildItem "$tools" -Recurse -File -ErrorAction SilentlyContinue | Select-Object @{n='File';e={$_.FullName.Replace($tools,'')}}, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1) node scripts\doctor.mjs     # self-check (exit 0 = pipeline ready)"
Write-Host "  2) put SESSDATA into bili-cookie.txt under the data root (comments / higher quality; keep it private)"
