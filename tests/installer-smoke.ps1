param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference='Stop'
$env:OPENCODE_CONFIG_DIR=Join-Path ([IO.Path]::GetTempPath()) ('sanitize-smoke-'+[Guid]::NewGuid().ToString('N'))
$root=$env:OPENCODE_CONFIG_DIR
$target=Join-Path $root 'plugins\opencode-temp-sanitize'
try {
  & (Join-Path $PackageRoot 'installer\Install.ps1') -PackageRoot $PackageRoot
  if (!(Test-Path -LiteralPath (Join-Path $target 'dist\server.mjs'))) {throw 'Server not installed'}
  if (!(Test-Path -LiteralPath (Join-Path $target 'dist\gui-experimental.cjs'))) {throw 'GUI not installed'}
  & (Join-Path $PackageRoot 'installer\Install.ps1') -PackageRoot $PackageRoot
  if (!(Get-ChildItem -LiteralPath (Join-Path $root '.temp-sanitize-install') -Directory -Filter 'backup-*')) {throw 'Backup missing'}
  & (Join-Path $PackageRoot 'installer\Uninstall.ps1')
  if (Test-Path -LiteralPath $target) {throw 'Uninstall failed'}
} finally {if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}
