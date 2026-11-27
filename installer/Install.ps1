param([string]$PackageRoot)
. (Join-Path $PSScriptRoot 'Common.ps1')
try { Install-Payload $PackageRoot } catch { Write-Host $_ -ForegroundColor Red; exit 1 }
