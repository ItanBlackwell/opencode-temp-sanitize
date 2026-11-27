. (Join-Path $PSScriptRoot 'Common.ps1')
try {Queue-Rollback} catch {Write-Host $_ -ForegroundColor Red;exit 1}
