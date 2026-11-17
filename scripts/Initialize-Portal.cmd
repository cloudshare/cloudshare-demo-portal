@echo off
setlocal
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;%PATH%"
echo Preparing the latest portal release. Existing data will be preserved.
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $tools=Join-Path $env:USERPROFILE ('.portal-maintenance-'+[guid]::NewGuid().ToString('N')); try { $ErrorActionPreference='Continue'; & git clone --single-branch --branch main -- https://github.com/cloudshare/cloudshare-demo-portal.git $tools 2>$null; $downloadExit=$LASTEXITCODE; $ErrorActionPreference='Stop'; if ($downloadExit -ne 0) { throw 'Download failed; installed portal unchanged.' }; & node (Join-Path $tools 'scripts\maintain-instance.mjs') 'C:\CloudShareDemoPortal'; exit $LASTEXITCODE } catch { Write-Host 'ERROR: Release preparation failed. Installed portal was not changed by the downloader.'; exit 1 }"
set "result=%errorlevel%"
pause
exit /b %result%
