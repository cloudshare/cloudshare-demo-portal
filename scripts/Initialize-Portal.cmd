@echo off
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
set "result=1"
cd /d "C:\CloudShareDemoPortal"
if errorlevel 1 (
  echo ERROR: The portal checkout is unavailable. Nothing was initialized.
  goto finished
)
echo Initializing this portal instance...
call npm.cmd run setup:instance
set "result=%errorlevel%"
if not "%result%"=="0" (
  echo ERROR: Initialization failed. The portal task was not started.
  goto finished
)
echo Initialization succeeded. Starting the existing portal task...
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; Start-ScheduledTask -TaskName 'issue489-next'"
set "result=%errorlevel%"
if not "%result%"=="0" (
  echo ERROR: The portal task could not be started. Initialization already succeeded; do not initialize again.
  goto finished
)
echo Portal start requested. Open this VM's portal and use its private admin credentials.
:finished
pause
exit /b %result%
