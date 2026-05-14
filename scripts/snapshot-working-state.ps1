# 作業ツリーをコミットしてから stable タグ（＋任意で zip）を作る。
# 例（リポジトリのルートで）:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\snapshot-working-state.ps1 -Message "mobile + VoicePeak LAN OK"
#   powershell ... -File .\scripts\snapshot-working-state.ps1 -Message "..." -AlsoZip
#
# 変更が無い場合はコミットをスキップし、backup-stable のみ実行する。

param(
    [Parameter(Mandatory = $true)]
    [string]$Message,
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
    git add -A
    $staged = @(git diff --cached --name-only)
    if ($staged.Count -gt 0) {
        git commit -m $Message
        Write-Host "Committed ($($staged.Count) paths): $Message"
    }
    else {
        Write-Warning "status was dirty but nothing staged; skipping commit."
    }
}
else {
    Write-Host "No local changes; skipping commit."
}

$backupScript = Join-Path $PSScriptRoot "backup-stable.ps1"
if ($AlsoZip) {
    & $backupScript -AlsoZip
}
else {
    & $backupScript
}
