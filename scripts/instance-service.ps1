param([ValidateSet('stop','start','docs')][string]$Action, [string]$Installation)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'docs') {
  $destination = 'C:\CloudSharePortalDocs'
  if (!(Test-Path -LiteralPath $destination -PathType Container) -or ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Documentation destination unavailable or linked' }
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $Installation 'build\docs-site') -File) {
    if ($file.Name -notmatch '^[a-z-]+\.(html|css)$') { throw 'Unexpected documentation artifact' }
    $target = Join-Path $destination $file.Name
    if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked documentation target' }
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
  }
  exit 0
}
$null = Get-ScheduledTask -TaskName 'issue489-next'
if ($Action -eq 'start') {
  $null = Enable-ScheduledTask -TaskName 'issue489-next'
  Start-ScheduledTask -TaskName 'issue489-next'
  exit 0
}
$null = Disable-ScheduledTask -TaskName 'issue489-next'
Stop-ScheduledTask -TaskName 'issue489-next'
$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
  $running = (Get-ScheduledTask -TaskName 'issue489-next').State -eq 'Running'
  $listener = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 3000)
  if (!$running -and $listener.Count -eq 0) { exit 0 }
  if ([DateTime]::UtcNow -ge $deadline) { throw 'Portal task or port 3000 did not stop; no data may be changed' }
  Start-Sleep -Milliseconds 250
} while ($true)
