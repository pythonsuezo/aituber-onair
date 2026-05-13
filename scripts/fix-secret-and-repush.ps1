# After removing secrets from the tree, amend the last commit and re-tag for push.
# Run from repo root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fix-secret-and-repush.ps1
#
# Prereq: delete the secret file and add .gitignore (or run after doing that).
# Then revoke the exposed PAT on GitHub and create a new one.

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not (Test-Path ".git")) {
  Write-Error "Not a git repo: $root"
}

# Drop PAT file from index if still tracked (file may already be deleted on disk)
git rm --cached --ignore-unmatch "githubのPAT.txt" 2>$null | Out-Null
if (Test-Path "githubのPAT.txt") {
  Remove-Item -Force "githubのPAT.txt"
}

git add -A
$st = git status --porcelain
if (-not $st) {
  Write-Host "Nothing to amend (clean). If push still fails, history may need filter-repo."
  exit 0
}

Write-Host "Amending last commit to drop secrets from that snapshot..."
git commit --amend --no-edit

# Remove local tag(s) pointing at the rejected commit (name from your failed push)
$badTag = "backup/stable-20260514-012129-622fa81"
if (git rev-parse -q --verify "refs/tags/$badTag" 2>$null) {
  git tag -d $badTag
  Write-Host "Deleted local tag: $badTag"
}

$short = git rev-parse --short HEAD
$date = Get-Date -Format "yyyyMMdd-HHmmss"
$newTag = "backup/stable-$date-$short"
git tag -a $newTag -m "Stable snapshot $date @ $short (secrets removed)"
Write-Host "Created tag: $newTag"

Write-Host "Pushing main and tag..."
$branch = git branch --show-current
git push origin "refs/heads/$branch"
git push origin "refs/tags/$newTag"

Write-Host "Done. Revoke the old PAT on GitHub: Settings -> Developer settings -> PATs"
