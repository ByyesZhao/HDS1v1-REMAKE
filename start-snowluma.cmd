@echo off
setlocal
title SnowLuma
set "SNOWLUMA_DIR=D:\SNOWLUMA"
cd /d "%SNOWLUMA_DIR%"
if errorlevel 1 goto failed

if not exist "node.exe" (
  echo SnowLuma bundled node.exe is missing in %SNOWLUMA_DIR%
  goto failed
)
if not exist "index.mjs" (
  echo SnowLuma entry point is missing in %SNOWLUMA_DIR%
  goto failed
)
"%SNOWLUMA_DIR%\node.exe" ".\check-node-version.cjs"
if errorlevel 1 goto failed
if "%~1"=="--check" (
  echo SnowLuma startup files and Node.js version verified.
  exit /b 0
)

echo Starting SnowLuma from %CD%
echo Press Ctrl+C to stop.
echo.
"%SNOWLUMA_DIR%\node.exe" ".\index.mjs"
set "APP_EXIT=%errorlevel%"
echo.
echo SnowLuma stopped. Exit code: %APP_EXIT%
pause
exit /b %APP_EXIT%

:failed
echo Startup failed.
if "%~1"=="--check" exit /b 1
pause
exit /b 1
