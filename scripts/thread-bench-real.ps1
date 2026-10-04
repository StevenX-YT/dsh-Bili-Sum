# thread-bench-real.ps1 - real transcription thread benchmark on retained wav
# Usage: node-equivalent direct whisper-cli runs at -t 12 and -t 16, same VAD+prompt settings as analyze
# Compares against the -t 8 analyze baseline (whisperElapsedSec recorded in bundle.json)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$wav = "output\BV1CAxaeHEeH_p8\audio-16k.wav"
if (-not (Test-Path $wav)) { Write-Host "wav missing"; exit 1 }
Write-Host ("wav OK: {0} bytes" -f (Get-Item $wav).Length)
$pf = Join-Path $env:TEMP "bench-prompt.txt"
$prompt = [Text.UTF8Encoding]::new($false).GetString([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'bench-prompt.txt'))).Trim()
[IO.File]::WriteAllText($pf, "-p`n$prompt`n", [Text.UTF8Encoding]::new($false))
foreach ($t in 12, 16) {
  $env:OPENBLAS_NUM_THREADS = [Math]::Min(8, $t)
  $of = Join-Path $env:TEMP "bench-t$t"
  Remove-Item "$of.json" -Force -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & "tools\whisper\Release\whisper-cli.exe" -m "tools\models\ggml-small.bin" -f $wav -l zh -oj -of $of -t $t --vad -vm "tools\models\ggml-silero-v6.2.0.bin" -vp 200 -vmsd 25 --suppress-nst "@$pf" --carry-initial-prompt 2>$null
  $sw.Stop()
  Write-Host ("REAL threads={0} wallSec={1}" -f $t, [Math]::Round($sw.Elapsed.TotalSeconds))
}
Write-Host "bench done"