param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference='Stop'
$env:OPENCODE_CONFIG_DIR=Join-Path ([IO.Path]::GetTempPath()) ('sanitize-smoke-'+[Guid]::NewGuid().ToString('N'))
$root=$env:OPENCODE_CONFIG_DIR
$target=Join-Path $root 'plugins\opencode-temp-sanitize'
. (Join-Path $PackageRoot 'installer\Common.ps1')
$script:running=$true
function Test-OpenCodeRunning {return $script:running}
# Do not spawn a worker in smoke tests; emulate a natural exit deterministically.
function Start-Activation { $null=Invoke-Pending }
try {
  Install-Payload $PackageRoot
  if(Test-Path -LiteralPath $target){throw 'Activated during simulated running session'}
  if(!(Read-State (Get-Store))){throw 'Pending state missing'}
  $script:running=$false
  if(!(Invoke-Pending)){throw 'Activation failed'}
  foreach($name in @('dist\server.mjs','dist\gui-experimental.cjs')){
    if(!(Test-Path -LiteralPath (Join-Path $target $name))){throw "Missing $name"}
  }
  $hash=(Get-FileHash -LiteralPath (Join-Path $target 'package.json')).Hash
  $script:running=$true
  Install-Payload $PackageRoot
  if((Get-FileHash -LiteralPath (Join-Path $target 'package.json')).Hash -ne $hash){throw 'Running installation modified'}
  $script:running=$false
  if(!(Invoke-Pending)){throw 'Upgrade failed'}
  if(!(Get-ChildItem -LiteralPath (Get-Store) -Directory -Filter 'backup-*')){throw 'Backup missing'}
  $script:running=$true
  Queue-Uninstall
  if(!(Test-Path -LiteralPath $target)){throw 'Uninstalled during active session'}
  $script:running=$false
  if(!(Invoke-Pending) -or (Test-Path -LiteralPath $target)){throw 'Uninstall failed'}
  Queue-Rollback
  if(!(Test-Path -LiteralPath $target)){throw 'Rollback failed'}
  Write-Host 'Deferred activation smoke test passed'
} finally {if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}
