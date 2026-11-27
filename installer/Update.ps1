param([switch]$NonInteractive,[string]$ExpectedVersion='')
. (Join-Path $PSScriptRoot 'Common.ps1')
try {
  $target=Join-Path (Get-Root) 'plugins\opencode-temp-sanitize'
  $current=Assert-Identity $target
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $release=Invoke-RestMethod -Uri 'https://api.github.com/repos/ItanBlackwell/opencode-temp-sanitize/releases/latest' -Headers @{'User-Agent'='Temp-Sanitize-Updater'}
  if($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$'){throw 'No supported stable release'}
  $version=$Matches[1]
  if($ExpectedVersion -and $version -ne $ExpectedVersion){throw 'Release changed; check again'}
  if([version]$version -le [version]$current.version){Write-Host 'Already current';exit 0}
  $name="Temp-Sanitize-Portable-$version.zip"
  $base="https://github.com/ItanBlackwell/opencode-temp-sanitize/releases/download/v$version"
  $asset=@($release.assets | Where-Object {$_.name -eq $name -and $_.state -eq 'uploaded' -and $_.browser_download_url -ceq "$base/$name"})
  $sumAsset=@($release.assets | Where-Object {$_.name -eq 'SHA256SUMS.txt' -and $_.state -eq 'uploaded' -and $_.browser_download_url -ceq "$base/SHA256SUMS.txt"})
  if($asset.Count -ne 1 -or $sumAsset.Count -ne 1 -or $asset[0].size -lt 1 -or $asset[0].size -gt 100MB -or $sumAsset[0].size -lt 1 -or $sumAsset[0].size -gt 64KB){throw 'Invalid release assets'}
  $tmp=Join-Path ([IO.Path]::GetTempPath()) ('sanitize-update-'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip=Join-Path $tmp $name
  $checks=Join-Path $tmp 'SHA256SUMS.txt'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $zip -TimeoutSec 60
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt" -OutFile $checks -TimeoutSec 60
  if((Get-Item -LiteralPath $zip).Length -ne $asset[0].size -or (Get-Item -LiteralPath $checks).Length -ne $sumAsset[0].size){throw 'Asset size mismatch'}
  $line=@(Get-Content -LiteralPath $checks | Where-Object {$_ -match ('^[a-fA-F0-9]{64}\s+\*?'+[regex]::Escape($name)+'$')})
  if($line.Count -ne 1 -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ine ($line[0] -split '\s+')[0]){throw 'Checksum mismatch'}
  $hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  if($asset[0].digest -and $asset[0].digest -ine "sha256:$hash"){throw 'Release digest mismatch'}
  if(!$NonInteractive -and (Read-Host "Install $version? [y/N]") -ne 'y'){exit 0}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach($file in @('package.json','dist/server.mjs','dist/gui-experimental.cjs','LICENSE','Install.cmd','Update.cmd','Uninstall.cmd','installer/Common.ps1','installer/Install.ps1','installer/Update.ps1','installer/Uninstall.ps1','Rollback.cmd','installer/Rollback.ps1')){
      $entries=@($archive.Entries | Where-Object {$_.FullName -ceq "Temp-Sanitize/$file"})
      if($entries.Count -ne 1){throw "Missing or duplicate payload: $file"}
      $entry=$entries[0]
      if(!$entry -or $entry.Length -gt 100MB){throw "Invalid payload: $file"}
      $dest=Join-Path $tmp $file
      New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$dest,$false)
    }
  } finally {$archive.Dispose()}
  $p=Assert-Identity $tmp
  if($p.version -ne $version){throw 'Version mismatch'}
  Install-Payload $tmp -ExpectedCurrent $current.version
} catch {Write-Host $_ -ForegroundColor Red;exit 1} finally {if($tmp -and (Test-Path -LiteralPath $tmp)){Remove-Item -LiteralPath $tmp -Recurse -Force}}
