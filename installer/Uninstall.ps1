. (Join-Path $PSScriptRoot 'Common.ps1')
try {Uninstall-Payload} catch {Write-Host $_ -ForegroundColor Red;exit 1}
