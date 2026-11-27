. (Join-Path $PSScriptRoot 'Common.ps1')
try {
  Assert-Closed
  $root=Get-Root
  $target=Join-Path $root 'plugins\opencode-temp-sanitize'
  if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';exit 0}
  $null=Assert-Identity $target
  $work=Join-Path $root '.temp-sanitize-install'
  Assert-Safe $work
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  Move-Item -LiteralPath $target -Destination (Join-Path $work ('uninstalled-'+[Guid]::NewGuid().ToString('N')))
  Write-Host 'Plugin removed from discovery. Settings and temporary data preserved.'
} catch {Write-Host $_ -ForegroundColor Red;exit 1}
