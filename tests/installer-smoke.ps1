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
  # Repeated successful installations retain at most two normal rollback copies.
  $abandoned=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $abandoned|Out-Null
  [IO.File]::WriteAllText((Join-Path $abandoned 'package.json'),'{}')
  $foreign=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $foreign|Out-Null
  [IO.File]::WriteAllText((Join-Path $foreign 'unrelated.txt'),'keep')
  1..4|ForEach-Object {Install-Payload $PackageRoot}
  if(@(Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*').Count -gt 2){throw 'Rollback copies accumulate'}
  if(Test-Path -LiteralPath $abandoned){throw 'Abandoned stage was retained'}
  if(!(Test-Path -LiteralPath (Join-Path $foreign 'unrelated.txt'))){throw 'Unexpected data removed'}
  $download=Join-Path $store ('download-'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $download|Out-Null
  [IO.File]::WriteAllText((Join-Path $download 'Temp-Sanitize-Portable-0.3.9.zip'),'partial')
  $handle=Lock-UpdateStore $store
  try{Trim-DownloadStore $store}finally{$handle.Dispose()}
  if(Test-Path -LiteralPath $download){throw 'Abandoned update download was retained'}
  Uninstall-Payload
  if(Test-Path -LiteralPath $target){throw 'Uninstall failed'}
  Restore-Payload
  if(!(Test-Path -LiteralPath (Join-Path $target 'dist\server.mjs'))){throw 'Rollback failed'}
  Write-Host 'Direct installation smoke test passed'
}finally{if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}
