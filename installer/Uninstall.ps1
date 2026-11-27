. (Join-Path $PSScriptRoot 'Common.ps1')
try {Queue-Uninstall} catch {Write-Host $_ -ForegroundColor Red;exit 1}
