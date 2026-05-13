# Tag current HEAD as backup/stable-* and push branch + tag to origin.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\push-stable-backup.ps1
#
# If you have uncommitted changes, commit first, or pass -AllowDirty (tag still points at HEAD only).

param(
    [string]$TagPrefix = "backup/stable",
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not (Test-Path ".git")) {
    Write-Error "Not a git repo: $root"
}

$dirty = git status --porcelain
if ($dirty -and -not $AllowDirty) {
    Write-Error @"
Uncommitted changes exist. Commit them first, then re-run:

  git add -A
  git commit -m "Describe stable state"

Or re-run with -AllowDirty (tag will still point only at the last commit, not your working tree).
"@
}

if (-not (git remote get-url origin 2>$null)) {
    Write-Error "No remote 'origin'. Add it with: git remote add origin <url>"
}

$branch = git branch --show-current
if (-not $branch) {
    Write-Error "Detached HEAD? Checkout a branch first."
}

$short = git rev-parse --short HEAD
$date = Get-Date -Format "yyyyMMdd-HHmmss"
$tag = "$TagPrefix-$date-$short"

if (git rev-parse -q --verify "refs/tags/$tag" 2>$null) {
    Write-Error "Tag already exists: $tag"
}

git tag -a $tag -m "Stable snapshot $date @ $short (branch $branch)"
Write-Host "Created tag: $tag"

Write-Host "Pushing branch '$branch' and tag to origin..."
git push origin "refs/heads/$branch"
git push origin "refs/tags/$tag"

Write-Host ""
Write-Host "Done. Restore this state later with:"
Write-Host "  git fetch origin tag $tag"
Write-Host "  git checkout $tag   # detached HEAD at snapshot"
Write-Host "  # or: git branch recover/$date $tag && git checkout recover/$date"
