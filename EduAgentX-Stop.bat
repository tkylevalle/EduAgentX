@echo off
setlocal
title EduAgentX stop
rem Stops the EduAgentX platform. Data in the Docker volumes is kept.

cd /d "%~dp0"
echo  [..] Stopping EduAgentX...
docker compose -p eduagentx-poc stop || (
  echo  [error] Could not stop the platform. Is Docker running?
  pause
  exit /b 1
)
echo  [ok] Stopped. Run EduAgentX-Start.bat to start it again.
call :sleep 4
exit /b 0

rem Waits about %1 seconds. timeout /t needs a console, ping does not.
:sleep
ping -n %~1 127.0.0.1 >nul
exit /b 0
