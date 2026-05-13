# Foreground vpeakserver for npm/concurrently.
# Default root: %USERPROFILE%\Documents\vpeakserver
# Override: $env:VPEAKSERVER_ROOT = "D:\path\to\vpeakserver"
#
# Optional flags (e.g. echo received text to stderr):
#   VPEAKSERVER_ECHO=1          -> adds -echo-requests (same as npm run dev:with-vpeak:echo)
#   VPEAKSERVER_EXTRA_FLAGS     -> space-separated extra args (no spaces inside one token)
#
# Note: Do not use "[...]" inside double-quoted strings in PowerShell (parsed as subexpressions).

$ErrorActionPreference = 'Stop'

$VpeakRoot = if ($env:VPEAKSERVER_ROOT -and $env:VPEAKSERVER_ROOT.Trim()) {
  $env:VPEAKSERVER_ROOT.Trim()
} else {
  Join-Path $env:USERPROFILE 'Documents\vpeakserver'
}

if (-not (Test-Path -LiteralPath $VpeakRoot)) {
  Write-Host ('vpeak: directory not found: ' + $VpeakRoot)
  Write-Host 'vpeak: set env VPEAKSERVER_ROOT to your vpeakserver clone root.'
  exit 1
}

$exe = Join-Path $VpeakRoot 'vpeakserver.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  Write-Host 'vpeak: vpeakserver.exe missing; running go build...'
  Push-Location $VpeakRoot
  try {
    go build -o vpeakserver.exe .
  } finally {
    Pop-Location
  }
}

Set-Location $VpeakRoot

$argList = [System.Collections.Generic.List[string]]::new()
$echoOn = $env:VPEAKSERVER_ECHO
if ($echoOn -eq '1' -or $echoOn -ieq 'true' -or $echoOn -ieq 'yes') {
  $null = $argList.Add('-echo-requests')
}
$extra = $env:VPEAKSERVER_EXTRA_FLAGS
if ($extra -and $extra.Trim()) {
  foreach ($t in ($extra.Trim() -split '\s+', [System.StringSplitOptions]::RemoveEmptyEntries)) {
    $null = $argList.Add($t)
  }
}

if ($argList.Count -gt 0) {
  Write-Host ('vpeak: extra args: ' + ($argList -join ' '))
}
Write-Host ('vpeak: starting ' + $exe + ' (Ctrl+C stops npm and this process)')
& $exe @argList
