@echo off
setlocal EnableExtensions
title EduAgentX launcher
rem Starts the EduAgentX platform and opens the web app for a demo.
rem Double-click it. Pass "rebuild" to rebuild the images first:
rem   EduAgentX-Start.bat rebuild

cd /d "%~dp0"
set "PROJECT=eduagentx-poc"
set "APP_URL=http://localhost:4300/#/overview"
set "HEALTH_URL=http://127.0.0.1:4300/api/package"
set "DOCKER_DESKTOP=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set "COMPOSE=docker compose -p %PROJECT%"

echo.
echo  EDUAGENTX  ^|  competency assurance for AI agents
echo  ------------------------------------------------
echo.

rem 1. Fast path: the app is already up, so just open it.
if /i not "%~1"=="rebuild" call :app_ready && (
  echo  [ok] EduAgentX is already running.
  goto :open
)

rem 2. Docker must be installed and running.
where docker >nul 2>&1 || (
  echo  [error] Docker is not installed. Install Docker Desktop, then run this again.
  goto :fail
)
docker info >nul 2>&1 && goto :docker_ready
if not exist "%DOCKER_DESKTOP%" (
  echo  [error] Docker is not running and Docker Desktop was not found. Start Docker, then run this again.
  goto :fail
)
echo  [..] Starting Docker Desktop...
start "" "%DOCKER_DESKTOP%"
for /l %%i in (1,1,60) do (
  docker info >nul 2>&1 && goto :docker_ready
  timeout /t 3 /nobreak >nul
)
echo  [error] Docker did not start within 3 minutes. Open Docker Desktop, wait for it, then run this again.
goto :fail

:docker_ready
echo  [ok] Docker is running.

rem 3. Local secrets and signing keys (created only when missing).
where node >nul 2>&1 || (
  echo  [error] Node.js is not installed. Install Node 24, then run this again.
  goto :fail
)
node scripts\setup-dev.js || goto :fail_setup

rem 4. Database first, then the per-service roles, then everything else.
echo  [..] Starting PostgreSQL and Redis...
%COMPOSE% up -d --wait postgres redis || goto :fail_compose
for %%s in (002_registry_role 003_curriculum_role 004_training_role 007_marketplace_role) do (
  %COMPOSE% exec -T postgres sh /docker-entrypoint-initdb.d/%%s.sh >nul || goto :fail_compose
)
echo  [ok] Database roles are in place.

if /i "%~1"=="rebuild" (
  echo  [..] Rebuilding and starting all services. The first build takes several minutes...
  %COMPOSE% up -d --build --wait || goto :fail_compose
) else (
  echo  [..] Starting all services. The first run builds images and takes several minutes...
  %COMPOSE% up -d --wait || goto :fail_compose
)

rem 5. Wait until the web app answers.
for /l %%i in (1,1,40) do (
  call :app_ready && goto :ready
  timeout /t 3 /nobreak >nul
)
echo  [error] The services started, but the web app did not answer on port 4300.
echo          Check it with: docker compose -p %PROJECT% logs web
goto :fail

:ready
echo  [ok] All services are healthy.

:open
echo.
echo  Opening %APP_URL%
if not "%EDUAGENTX_NO_BROWSER%"=="1" start "" "%APP_URL%"
echo.
echo  Demo keys in the Lifecycle Lab: 2 then Enter = hostile agent, 1 then Enter = competent agent.
echo  Stop the platform with EduAgentX-Stop.bat (your data is kept).
echo.
timeout /t 8 >nul
exit /b 0

rem Returns 0 when the web app answers with a status below 500.
:app_ready
set "CODE="
for /f %%c in ('curl -s -o nul -w "%%{http_code}" --max-time 3 "%HEALTH_URL%" 2^>nul') do set "CODE=%%c"
if not defined CODE exit /b 1
if "%CODE%"=="000" exit /b 1
if %CODE% GEQ 500 exit /b 1
exit /b 0

:fail_setup
echo  [error] Local setup failed (node scripts\setup-dev.js). Read the message above.
goto :fail

:fail_compose
echo  [error] Docker Compose failed. Read the message above, or run:
echo          docker compose -p %PROJECT% ps
goto :fail

:fail
echo.
pause
exit /b 1
