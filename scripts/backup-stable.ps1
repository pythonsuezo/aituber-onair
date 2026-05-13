# Stable snapshot: git tag + optional zip (excludes node_modules).
# Run from repo root:  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-stable.ps1
# Optional:           powershell ... -File .\scripts\backup-stable.ps1 -AlsoZip

param(
    [string]$TagPrefix = "backup/stable",
    [switch]$AlsoZip
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not (Test-Path ".git")) {
    Write-Error "Not a git repo: $root"
}

$dirty = git status --porcelain
if ($dirty) {
    Write-Warning "Working tree has uncommitted changes. Tag will point at last commit; uncommitted work is NOT in the tag."
    git status -sb
}

$short = git rev-parse --short HEAD
$date = Get-Date -Format "yyyyMMdd-HHmmss"
$tag = "$TagPrefix-$date-$short"

git tag -a $tag -m "Stable backup $date @ $short"
Write-Host "Created annotated tag: $tag"
Write-Host "List: git tag -l '$TagPrefix*'"

if ($AlsoZip) {
    $zipName = "aituber-onair-$date-$short.zip"
    $zipPath = Join-Path ([Environment]::GetFolderPath("Desktop")) $zipName
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    # Compress-Archive is slow on huge trees; exclude heavy dirs via temp copy is heavy.
    # Simple approach: git archive (no node_modules — restore with npm install)
    git archive --format=zip -o $zipPath HEAD
    Write-Host "Source zip (no node_modules): $zipPath"
}

Write-Host "Done. Push tag to remote: git push origin $tag"
