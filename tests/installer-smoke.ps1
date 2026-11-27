param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference='Stop'
$env:OPENCODE_CONFIG_DIR=Join-Path ([IO.Path]::GetTempPath()) ('sanitize-smoke-'+[Guid]::NewGuid().ToString('N'))
$root=$env:OPENCODE_CONFIG_DIR
$target=Join-Path $root 'plugins\opencode-temp-sanitize'
. (Join-Path $PackageRoot 'installer\Common.ps1')
try {
  # Simulate a leftover deferred operation; direct install must neutralize it.
  $store=Get-Store
  [IO.File]::WriteAllText((Join-Path $store 'pending.json'),'{"action":"uninstall"}')
  Install-Payload $PackageRoot
  if(Test-Path -LiteralPath (Join-Path $store 'pending.json')){throw 'Legacy operation still pending'}
  foreach($name in (Get-PayloadFiles)){
    if(!(Test-Path -LiteralPath (Join-Path $target $name))){throw "Missing $name"}
  }
  [IO.File]::WriteAllText((Join-Path $target 'unrelated.txt'),'keep')
  $manifest=Assert-Identity $target
  if($manifest.main -ne './dist/server.mjs'){throw 'Server entry missing'}
  Install-Payload $PackageRoot
  if(!(Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*')){throw 'Backup missing'}
  if(!(Test-Path -LiteralPath (Join-Path $target 'unrelated.txt'))){throw 'Unrelated file removed'}
  Uninstall-Payload
  if(Test-Path -LiteralPath $target){throw 'Uninstall failed'}
  Restore-Payload
  if(!(Test-Path -LiteralPath (Join-Path $target 'dist\server.mjs'))){throw 'Rollback failed'}
  Write-Host 'Direct installation smoke test passed'
}finally{if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}
