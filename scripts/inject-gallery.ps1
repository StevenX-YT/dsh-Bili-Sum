# inject-gallery.ps1 - inject tsGal runtime v3.6 (gallery + jump links + float player) into notes HTML
# Usage: & scripts\inject-gallery.ps1 -HtmlPath <note.html> [<note2.html> ...]
# Injects window.__TSGAL__ = { frames, video(title/part), stream } + gallery-runtime.js v3.6.
# stream: bilibili direct MP4 URL fetched online at inject time (native <video> playback, nothing saved locally).
# v3.6 note: subtitle system removed from runtime; archive at archive-subtitles/ for future restore.
# Idempotent: files already containing any tsGal block get it replaced in place (v1..v3.5 -> v3.6, no double-inject).
param(
  [Parameter(Mandatory = $true, ValueFromPipeline = $true)]
  [string[]]$HtmlPath
)

$ErrorActionPreference = 'Stop'
$rtPath = Join-Path $PSScriptRoot '..\templates\gallery-runtime.js'
$runtime = [IO.File]::ReadAllText((Resolve-Path $rtPath))

foreach ($file in $HtmlPath) {
  $file = Resolve-Path $file
  $dir = Split-Path $file
  $bundlePath = Join-Path $dir 'bundle.json'
  if (-not (Test-Path $bundlePath)) { Write-Host "SKIP (no bundle.json): $file"; continue }

  $html = [IO.File]::ReadAllText($file)

  $b = Get-Content $bundlePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $framePairs = @()
  foreach ($f in $b.frames) {
    $name = [IO.Path]::GetFileName($f.file)
    $t = [Math]::Round([double]$f.timeSec, 1)
    $framePairs += "{f:'$name',t:$t}"
  }
  if ($framePairs.Count -eq 0) { Write-Host "SKIP (no frames): $file"; continue }
  $framesJson = '[' + ($framePairs -join ',') + ']'

  # Video info: bvid from bundle, fallback to bilibili link in HTML; page defaults to 1 (p omitted for single-part videos)
  $bvid = "$($b.video.bvid)"
  if (-not $bvid) {
    $m = [regex]::Match($html, 'bilibili\.com/video/(BV[0-9A-Za-z]{10})')
    if ($m.Success) { $bvid = $m.Groups[1].Value }
  }
  $page = 1
  if ($b.video.page) { $page = [int]$b.video.page } else {
    $m2 = [regex]::Match($html, 'bilibili\.com/video/BV[0-9A-Za-z]{10}\?p=(\d+)')
    if ($m2.Success) { $page = [int]$m2.Groups[1].Value }
  }
  if (-not $bvid) { Write-Host "SKIP (no bvid): $file"; continue }
  # Title/part for the float player header (single-quoted JS string; escape backslashes and quotes)
  $esc = { param($s) ([string]$s).Replace('\', '\\').Replace("'", "\'").Replace("`r", ' ').Replace("`n", ' ') }
  $title = & $esc "$($b.video.title)"
  $part = & $esc "$($b.video.part)"
  $videoJson = "{bvid:'$bvid',page:$page,title:'$title',part:'$part'}"

  # fetch bilibili direct stream URL online (native <video> playback). Best-effort: null on any failure.
  $streamJson = 'null'
  try {
    $nodeOut = & node (Join-Path $PSScriptRoot 'fetch-stream.mjs') $bvid $page 2>$null
    if ($LASTEXITCODE -eq 0 -and $nodeOut) {
      $sj = $nodeOut | Select-Object -Last 1 | ConvertFrom-Json
      if ($sj.url) {
        $u = "$($sj.url)".Replace('\', '\\').Replace("'", "\'")
        $streamJson = "{url:'$u',quality:$([int]$sj.quality),exp:$([int64]$sj.exp)}"
        Write-Host "  stream: qn=$($sj.quality) exp=$($sj.exp)"
      }
    }
  } catch { Write-Host "  stream: fetch failed (will use iframe fallback)" }

  $injectInner = "window.__TSGAL__ = { frames: $framesJson, video: $videoJson, stream: $streamJson };`r`n/* tsGal-runtime */`r`n$runtime"
  if ($html.Contains('tsGal-runtime')) {
    # v1->v2 in-place upgrade: replace old injected block by start/end markers (more robust than regex)
    $startMarker = '<script>window.__TSGAL__'
    $s = $html.IndexOf($startMarker)
    if ($s -lt 0) { Write-Host "SKIP (block start not found): $file"; continue }
    $e = $html.IndexOf('</script>', $s)
    if ($e -lt 0) { Write-Host "SKIP (block end not found): $file"; continue }
    $e += '</script>'.Length
    $oldLen = $e - $s
    $html = $html.Substring(0, $s) + "<script>$injectInner`r`n</script>" + $html.Substring($e)
    [IO.File]::WriteAllText($file, $html, [Text.UTF8Encoding]::new($false))
    $kb = [math]::Round((Get-Item $file).Length / 1KB, 1)
    Write-Host "UPGRADED ->v3.6 (bvid=$bvid page=$page, $($framePairs.Count) frames, old block $oldLen chars): $file -> $kb KB"
    continue
  }

  $inject = "<script>$injectInner`r`n</script>`r`n</body>"
  $html = $html.Replace('</body>', $inject)
  [IO.File]::WriteAllText($file, $html, [Text.UTF8Encoding]::new($false))
  $kb = [math]::Round((Get-Item $file).Length / 1KB, 1)
  Write-Host "INJECTED v3.6 (bvid=$bvid page=$page, $($framePairs.Count) frames): $file -> $kb KB"
}
