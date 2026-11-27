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


function Get-Store {
  $store=Join-Path (Get-Root) '.temp-sanitize-install'
  Assert-Safe $store
  New-Item -ItemType Directory -Force -Path $store | Out-Null
  return $store
}
function Lock-Store([string]$Store) {
  $lock=Join-Path $Store 'operation.lock'
  Assert-Safe $lock
  return [IO.File]::Open($lock,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
}
function Cancel-LegacyPending([string]$Store) {
  # Same lock as the retired activation worker. Never allow its queued payload
  # to overwrite a successful direct install when OpenCode next exits.
  $pending=Join-Path $Store 'pending.json'
  Assert-Safe $pending
  if(Test-Path -LiteralPath $pending){
    Move-Item -LiteralPath $pending -Destination (Join-Path $Store ('cancelled-'+[Guid]::NewGuid().ToString('N')+'.json'))
  }
}
function Get-PayloadFiles {
  @('dist\server.mjs','dist\gui-experimental.cjs','LICENSE','Install.cmd','Update.cmd','Uninstall.cmd','Rollback.cmd','installer\Common.ps1','installer\Install.ps1','installer\Update.ps1','installer\Uninstall.ps1','installer\Rollback.ps1','package.json')
}

# Only remove trees consisting entirely of known plugin payload files. Never
# recursively follow reparse points or discard unexpected user/recovery files.
function Test-OwnedTree([string]$Dir,[string[]]$Allowed) {
  Assert-Safe $Dir
  if(!(Test-Path -LiteralPath $Dir -PathType Container)){return $false}
  $prefix=$Dir+'\'
  $stack=New-Object 'System.Collections.Generic.Stack[string]'
  $stack.Push($Dir)
  while($stack.Count){
    $folder=$stack.Pop()
    foreach($item in (Get-ChildItem -LiteralPath $folder -Force)){
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){return $false}
      $rel=$item.FullName.Substring($prefix.Length)
      if($item.PSIsContainer){
        $sub=$rel+'\'
        if(@($Allowed|Where-Object {$_.StartsWith($sub,[StringComparison]::OrdinalIgnoreCase)}).Count -eq 0){return $false}
        $stack.Push($item.FullName)
      }elseif($Allowed -notcontains $rel){return $false}
    }
  }
  return $true
}
function Remove-OwnedTree([string]$Dir,[string[]]$Allowed) {
  if(Test-OwnedTree $Dir $Allowed){Remove-Item -LiteralPath $Dir -Recurse -Force;return $true}
  return $false
}
function Trim-InstallStore([string]$Store,[switch]$Backups) {
  # Call under operation.lock. Stages cannot belong to another live install.
  $files=@(Get-PayloadFiles)
  foreach($item in (Get-ChildItem -LiteralPath $Store -Force)){
    try{
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
      if($item.PSIsContainer -and $item.Name -cmatch '^stage-[0-9a-f]{32}
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    Trim-InstallStore $store
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    try{Trim-InstalledSwaps $target;Trim-InstallStore $store -Backups}catch{Write-Verbose 'Maintenance deferred'}
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    try{if(Test-Path -LiteralPath $stage){$null=Remove-OwnedTree $stage @(Get-PayloadFiles)}}finally{$handle.Dispose()}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Trim-InstallStore $store
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    try{Trim-InstallStore $store -Backups}catch{Write-Verbose 'Maintenance deferred'}
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
){
        $null=Remove-OwnedTree $item.FullName $files
      }elseif(!$item.PSIsContainer -and $item.Name -cmatch '^cancelled-[0-9a-f]{32}\.json
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    $handle.Dispose()
    if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
){
        Remove-Item -LiteralPath $item.FullName -Force
      }
    }catch{Write-Verbose 'Skipped inaccessible installer debris'}
  }
  if(!$Backups){return}
  # Retain the two newest complete, recognized rollback copies. Anything
  # containing unknown files or incomplete recovery data is left alone.
  $kept=0
  $dirs=Get-ChildItem -LiteralPath $Store -Directory -Force|Where-Object {$_.Name -cmatch '^backup-[0-9a-f]{32}
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    $handle.Dispose()
    if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
}|Sort-Object LastWriteTime -Descending
  foreach($dir in $dirs){
    try{
      if(!(Test-OwnedTree $dir.FullName $files)){continue}
      $null=Assert-Identity $dir.FullName
      $complete=$true
      foreach($file in $files){if(!(Test-Path -LiteralPath (Join-Path $dir.FullName $file) -PathType Leaf)){$complete=$false;break}}
      if(!$complete){continue}
      $kept++
      if($kept -gt 2){$null=Remove-OwnedTree $dir.FullName $files}
    }catch{Write-Verbose 'Skipped unsafe or incomplete rollback copy'}
  }
}

function Lock-UpdateStore([string]$Store) {
  $lock=Join-Path $Store 'update.lock'
  Assert-Safe $lock
  return [IO.File]::Open($lock,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
}
function Remove-DownloadWorkspace([string]$Dir) {
  if(!(Test-Path -LiteralPath $Dir -PathType Container)){return}
  Assert-Safe $Dir
  $allowed=@(Get-PayloadFiles)+@('SHA256SUMS.txt')
  foreach($file in (Get-ChildItem -LiteralPath $Dir -File -Force)){
    if($file.Name -cmatch '^Temp-Sanitize-Portable-\d+\.\d+\.\d+\.zip
  # Only after a successful installation; preserve unexpected entries.
  foreach($file in (Get-PayloadFiles)){
    $dest=Join-Path $Target $file
    $parent=Split-Path $dest
    $name=[IO.Path]::GetFileName($dest)
    if(!(Test-Path -LiteralPath $dest -PathType Leaf)){continue}
    Assert-Safe $parent
    foreach($item in (Get-ChildItem -LiteralPath $parent -File -Force)){
      if($item.Name -cmatch ('^'+[regex]::Escape($name)+'\.swap-[0-9a-f]{32}\.tmp(\.bak)?
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    $handle.Dispose()
    if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
) -and !($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){
        try{Remove-Item -LiteralPath $item.FullName -Force}catch{Write-Verbose 'Skipped locked swap file'}
      }
    }
  }
}

function Copy-Payload([string]$Source,[string]$Stage) {
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    $handle.Dispose()
    if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
){$allowed+=@($file.Name)}
  }
  $null=Remove-OwnedTree $Dir $allowed
}
function Trim-DownloadStore([string]$Store) {
  # The separate update lock covers the download, extraction and installation.
  foreach($dir in (Get-ChildItem -LiteralPath $Store -Directory -Force)){
    if($dir.Name -cmatch '^download-[0-9a-f]{32}
  # Only after a successful installation; preserve unexpected entries.
  foreach($file in (Get-PayloadFiles)){
    $dest=Join-Path $Target $file
    $parent=Split-Path $dest
    $name=[IO.Path]::GetFileName($dest)
    if(!(Test-Path -LiteralPath $dest -PathType Leaf)){continue}
    Assert-Safe $parent
    foreach($item in (Get-ChildItem -LiteralPath $parent -File -Force)){
      if($item.Name -cmatch ('^'+[regex]::Escape($name)+'\.swap-[0-9a-f]{32}\.tmp(\.bak)?
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    $handle.Dispose()
    if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
) -and !($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){
        try{Remove-Item -LiteralPath $item.FullName -Force}catch{Write-Verbose 'Skipped locked swap file'}
      }
    }
  }
}

function Copy-Payload([string]$Source,[string]$Stage) {
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    $handle.Dispose()
    if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
 -and !($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)){
      try{Remove-DownloadWorkspace $dir.FullName}catch{Write-Verbose 'Skipped inaccessible download workspace'}
    }
  }
}

function Trim-InstalledSwaps([string]$Target){
  # Only after a successful installation; preserve unexpected entries.
  foreach($file in (Get-PayloadFiles)){
    $dest=Join-Path $Target $file
    $parent=Split-Path $dest
    $name=[IO.Path]::GetFileName($dest)
    if(!(Test-Path -LiteralPath $dest -PathType Leaf)){continue}
    Assert-Safe $parent
    foreach($item in (Get-ChildItem -LiteralPath $parent -File -Force)){
      if($item.Name -cmatch ('^'+[regex]::Escape($name)+'\.swap-[0-9a-f]{32}\.tmp(\.bak)?
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    $handle.Dispose()
    if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
) -and !($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){
        try{Remove-Item -LiteralPath $item.FullName -Force}catch{Write-Verbose 'Skipped locked swap file'}
      }
    }
  }
}

function Copy-Payload([string]$Source,[string]$Stage) {
  $p=Assert-Identity $Source
  if($p.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
  foreach($file in (Get-PayloadFiles)){
    $src=Join-Path $Source $file
    Assert-Safe $src
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Missing $file"}
    $dst=Join-Path $Stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
  }
  $p.main='./dist/server.mjs'
  $p.exports=[pscustomobject]@{'.'='./dist/server.mjs';'./gui-experimental'='./dist/gui-experimental.cjs'}
  foreach($key in @('dependencies','devDependencies','scripts')){$p.PSObject.Properties.Remove($key)}
  [IO.File]::WriteAllText((Join-Path $Stage 'package.json'),($p|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  return $p
}
function Set-FileAtomic([string]$Source,[string]$Destination) {
  Assert-Safe $Source
  Assert-Safe $Destination
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination)|Out-Null
  $temp=$Destination+'.swap-'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $swapBackup=$temp+'.bak'
  try {
    Copy-Item -LiteralPath $Source -Destination $temp
    if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($temp,$Destination,$swapBackup)}
    else{[IO.File]::Move($temp,$Destination)}
  }finally{
    foreach($file in @($temp,$swapBackup)){
      if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
    }
  }
}
function Install-Payload([string]$Source,[string]$ExpectedCurrent='') {
  $store=Get-Store
  $handle=Lock-Store $store
  $stage=Join-Path $store ('stage-'+[Guid]::NewGuid().ToString('N'))
  try {
    $p=Copy-Payload $Source $stage
    $plugins=Join-Path (Get-Root) 'plugins'
    $target=Join-Path $plugins 'opencode-temp-sanitize'
    Assert-Safe $target
    New-Item -ItemType Directory -Force -Path $plugins|Out-Null
    if($ExpectedCurrent){
      $installed=Assert-Identity $target
      if($installed.version -ne $ExpectedCurrent -or [version]$p.version -le [version]$installed.version){throw 'Installed version changed or update is not newer'}
    }
    Cancel-LegacyPending $store
    if(!(Test-Path -LiteralPath $target)){
      Move-Item -LiteralPath $stage -Destination $target
    }else{
      $null=Assert-Identity $target
      $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
      $files=@(Get-PayloadFiles)
      # Back up every affected file before changing anything; unrelated files are untouched.
      foreach($file in $files){
        $dest=Join-Path $target $file
        Assert-Safe $dest
        if(Test-Path -LiteralPath $dest){
          if(!(Test-Path -LiteralPath $dest -PathType Leaf)){throw "Not a file: $dest"}
          $saved=Join-Path $backup $file
          New-Item -ItemType Directory -Force -Path (Split-Path $saved)|Out-Null
          Copy-Item -LiteralPath $dest -Destination $saved
        }
      }
      $changed=New-Object 'System.Collections.Generic.List[string]'
      try {
        # Commit the manifest last. Each replacement is atomic; the pair is not.
        foreach($file in $files){
          Set-FileAtomic (Join-Path $stage $file) (Join-Path $target $file)
          $changed.Add($file)
        }
      }catch{
        $original=$_
        $rollbackFailed=$false
        for($i=$changed.Count-1;$i -ge 0;$i--){
          $file=$changed[$i];$dest=Join-Path $target $file;$saved=Join-Path $backup $file
          try{
            if(Test-Path -LiteralPath $saved){Set-FileAtomic $saved $dest}
            else{Remove-Item -LiteralPath $dest -Force}
          }catch{$rollbackFailed=$true;Write-Warning "Restore failed: $file"}
        }
        if($rollbackFailed){throw "Install and rollback failed; recover from $backup"}
        throw $original
      }
      Write-Host "Previous files saved at $backup"
    }
    Write-Host "Installed $($p.version) at $target. Restart OpenCode to load the new server version. No process was stopped."
    Write-Host 'If an older explicit plugin reference exists in opencode.json(c), remove it to avoid duplicate loading.'
  }finally{
    $handle.Dispose()
    if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Uninstall-Payload {
  $store=Get-Store
  $handle=Lock-Store $store
  try{
    Cancel-LegacyPending $store
    $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
    if(!(Test-Path -LiteralPath $target)){Write-Host 'Not installed';return}
    $null=Assert-Identity $target
    $backup=Join-Path $store ('backup-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Removed from plugin discovery. Settings preserved. Previous installation: $backup. Restart OpenCode."
  }finally{$handle.Dispose()}
}
function Restore-Payload {
  $store=Get-Store
  $backup=Get-ChildItem -LiteralPath $store -Directory -Filter 'backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No previous installation available'}
  Install-Payload $backup.FullName
}
