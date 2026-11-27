$ErrorActionPreference = 'Stop'
function Get-Root {
  if ($env:OPENCODE_CONFIG_DIR) {
    if (-not [IO.Path]::IsPathRooted($env:OPENCODE_CONFIG_DIR)) { throw 'OPENCODE_CONFIG_DIR must be absolute' }
    return [IO.Path]::GetFullPath($env:OPENCODE_CONFIG_DIR)
  }
  return (Join-Path $HOME '.config\opencode')
}
function Assert-Safe([string]$Path) {
  $p=[IO.Path]::GetFullPath($Path)
  while($p) {
    if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Reparse point: $p" }
    $next=[IO.Path]::GetDirectoryName($p)
    if (!$next -or $next -eq $p) { break }
    $p=$next
  }
}
function Assert-Closed {
  if (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'opencode' }) { throw 'Close OpenCode and its background server first.' }
}
function Assert-Identity([string]$Dir) {
  Assert-Safe $Dir
  $manifest=Join-Path $Dir 'package.json'
  Assert-Safe $manifest
  $p=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  if ($p.name -ne '@gfn-cis/opencode-temp-sanitize') { throw 'Unexpected plugin identity' }
  return $p
}
function Install-Payload([string]$Source) {
  Assert-Closed
  $p=Assert-Identity $Source
  $root=Get-Root
  $plugins=Join-Path $root 'plugins'
  $target=Join-Path $plugins 'opencode-temp-sanitize'
  $work=Join-Path $root '.temp-sanitize-install'
  foreach($x in @($root,$plugins,$target,$work)){Assert-Safe $x}
  if(Test-Path -LiteralPath $target){$null=Assert-Identity $target}
  New-Item -ItemType Directory -Force -Path $plugins,$work | Out-Null
  $lock=Join-Path $work 'install.lock'
  $handle=[IO.File]::Open($lock,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $stage=Join-Path $work ([Guid]::NewGuid().ToString('N'))
  $backup=Join-Path $work ('backup-'+[Guid]::NewGuid().ToString('N'))
  try {
    foreach($file in @('package.json','dist\server.mjs','dist\gui-experimental.cjs','LICENSE','Install.cmd','Update.cmd','Uninstall.cmd','installer\Common.ps1','installer\Install.ps1','installer\Update.ps1','installer\Uninstall.ps1')){
      $src=Join-Path $Source $file
      Assert-Safe $src
      if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
      $dst=Join-Path $stage $file
      New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
      Copy-Item -LiteralPath $src -Destination $dst
    }
    $manifest=Join-Path $stage 'package.json'
    $p.main='./dist/server.mjs'
    $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
    $p.PSObject.Properties.Remove('dependencies')
    $p.PSObject.Properties.Remove('devDependencies')
    $p.PSObject.Properties.Remove('scripts')
    [IO.File]::WriteAllText($manifest,($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
    if(Test-Path -LiteralPath $target){Move-Item -LiteralPath $target -Destination $backup}
    try {Move-Item -LiteralPath $stage -Destination $target}
    catch {if(Test-Path -LiteralPath $backup){Move-Item -LiteralPath $backup -Destination $target};throw}
    Write-Host "Installed $($p.version). Restart OpenCode. Backup (if upgrading): $backup"
  } finally {
    $handle.Dispose()
    Remove-Item -LiteralPath $lock -Force
    if(Test-Path -LiteralPath $stage){Assert-Safe $stage; Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
