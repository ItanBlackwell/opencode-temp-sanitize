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
function Assert-Identity([string]$Dir) {
  Assert-Safe $Dir
  $manifest=Join-Path $Dir 'package.json'
  Assert-Safe $manifest
  $p=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  if ($p.name -ne '@gfn-cis/opencode-temp-sanitize') { throw 'Unexpected plugin identity' }
  return $p
}

function Test-OpenCodeRunning {
  return [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'opencode' } | Select-Object -First 1)
}
function Get-Store {
  $root=Get-Root
  $store=Join-Path $root '.temp-sanitize-install'
  Assert-Safe $store
  New-Item -ItemType Directory -Force -Path $store | Out-Null
  return $store
}
function Lock-Store([string]$Store) {
  $lock=Join-Path $Store 'operation.lock'
  Assert-Safe $lock
  return [IO.File]::Open($lock,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
}
function Write-State([string]$Store,$State) {
  $file=Join-Path $Store 'pending.json'
  Assert-Safe $file
  $temp=Join-Path $Store ('state-'+[Guid]::NewGuid().ToString('N')+'.tmp')
  [IO.File]::WriteAllText($temp,($State|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  if(Test-Path -LiteralPath $file){[IO.File]::Replace($temp,$file,$null)}
  else{[IO.File]::Move($temp,$file)}
}
function Read-State([string]$Store) {
  $file=Join-Path $Store 'pending.json'
  Assert-Safe $file
  if(Test-Path -LiteralPath $file){return (Get-Content -LiteralPath $file -Raw|ConvertFrom-Json)}
  return $null
}
function Copy-Payload([string]$Source,[string]$Stage) {
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in @('package.json','dist\server.mjs','dist\gui-experimental.cjs','LICENSE','Install.cmd','Update.cmd','Uninstall.cmd','Rollback.cmd','Apply.cmd','installer\Common.ps1','installer\Install.ps1','installer\Update.ps1','installer\Uninstall.ps1','installer\Rollback.ps1','installer\Apply.ps1')){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  $p.PSObject.Properties.Remove('dependencies')
  $p.PSObject.Properties.Remove('devDependencies')
  $p.PSObject.Properties.Remove('scripts')
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Invoke-Pending {
  $store=Get-Store
  $handle=Lock-Store $store
  try {
    $state=Read-State $store
    if(!$state){return $true}
    if(Test-OpenCodeRunning){return $false}
    $root=Get-Root
    $plugins=Join-Path $root 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    foreach($x in @($plugins,$target)){Assert-Safe $x}
    New-Item -ItemType Directory -Force -Path $plugins | Out-Null
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    $stage=$null
    if($state.action -eq 'install'){
      if($state.stage -notmatch '^version-[a-f0-9]{32}$'){throw 'Invalid staged version'}
      $stage=Join-Path $store $state.stage
      $null=Assert-Identity $stage
      foreach($file in @('dist\server.mjs','dist\gui-experimental.cjs')){
        $p=Join-Path $stage $file; Assert-Safe $p
        if(!(Test-Path -LiteralPath $p -PathType Leaf)){throw 'Incomplete staged version'}
      }
    }elseif($state.action -ne 'uninstall'){throw 'Unknown pending operation'}
    if(Test-Path -LiteralPath $target){$null=Assert-Identity $target}
    if(Test-OpenCodeRunning){return $false}
    if(Test-Path -LiteralPath $target){Move-Item -LiteralPath $target -Destination $backup}
    try {if($stage){Move-Item -LiteralPath $stage -Destination $target}}
    catch {if(Test-Path -LiteralPath $backup){Move-Item -LiteralPath $backup -Destination $target};throw}
    Remove-Item -LiteralPath (Join-Path $store 'pending.json') -Force
    Write-Host "Applied $($state.action). Previous version retained in $backup (if present)."
    return $true
  }finally{$handle.Dispose()}
}
function Start-Activation {
  if(Invoke-Pending){return}
  $store=Get-Store
  # Copy trusted local maintenance code outside the extracted ZIP and watched tree.
  $worker=Join-Path $store ('worker-'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $worker | Out-Null
  foreach($file in @('Common.ps1','Apply.ps1')){
    $src=Join-Path $PSScriptRoot $file; Assert-Safe $src
    Copy-Item -LiteralPath $src -Destination (Join-Path $worker $file)
  }
  $apply=Join-Path $worker 'Apply.ps1'
  $null=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$apply+'"'),'-WaitForExit') -WindowStyle Hidden
  Write-Host 'Operation queued. OpenCode stays running. Apply.cmd can retry if the worker is interrupted.'
}
function Install-Payload([string]$Source) {
  $store=Get-Store
  $handle=Lock-Store $store
  try {
    $id='version-'+[Guid]::NewGuid().ToString('N')
    $stage=Join-Path $store $id
    $p=Copy-Payload $Source $stage
    Write-State $store @{action='install';stage=$id;version=$p.version}
    Write-Host "Prepared $($p.version)"
  }finally{$handle.Dispose()}
  Start-Activation
}
function Queue-Uninstall {
  $store=Get-Store
  $handle=Lock-Store $store
  try{Write-State $store @{action='uninstall'}}finally{$handle.Dispose()}
  Start-Activation
}
function Queue-Rollback {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
    if(!$backup){throw 'No previous installation available'}
    $id='version-'+[Guid]::NewGuid().ToString('N')
    $p=Copy-Payload $backup.FullName (Join-Path $store $id)
    Write-State $store @{action='install';stage=$id;version=$p.version}
  }finally{$handle.Dispose()}
  Start-Activation
}
