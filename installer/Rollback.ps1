. (Join-Path $PSScriptRoot 'Common.ps1')
try {Restore-Payload} catch {Write-Host $_ -ForegroundColor Red;exit 1}
