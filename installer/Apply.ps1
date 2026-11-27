param([switch]$WaitForExit)
. (Join-Path $PSScriptRoot 'Common.ps1')
$store=Get-Store
$log=Join-Path $store 'activation.log'
Assert-Safe $log
do {
  try {
    if(Invoke-Pending){exit 0}
    if(!$WaitForExit){Write-Host 'OpenCode is running; activation still queued.';exit 0}
  } catch {
    Add-Content -LiteralPath $log -Value ("{0:o} {1}" -f [DateTime]::UtcNow,$_.Exception.Message)
    if(!$WaitForExit){Write-Host $_ -ForegroundColor Red;exit 1}
  }
  Start-Sleep -Milliseconds 500
} while($WaitForExit)
