@echo off
setlocal
title HDSI Remake - Koishi
cd /d "%~dp0runtime"
if errorlevel 1 goto failed

where.exe node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.13 or newer.
  goto failed
)
if not exist "node_modules\koishi\bin.js" (
  echo Koishi is missing. Run npm ci --prefix runtime in the project directory.
  goto failed
)
if not exist "..\lib\index.js" (
  echo HDSI build is missing. Run npm run build in the project directory.
  goto failed
)
node.exe check.cjs
if errorlevel 1 goto failed
if "%~1"=="--check" exit /b 0

echo Starting HDSI Remake from %CD%
echo Koishi console: http://127.0.0.1:5141
echo Press Ctrl+C to stop.
echo.
node.exe "node_modules\koishi\bin.js" start
set "APP_EXIT=%errorlevel%"
echo.
echo HDSI stopped. Exit code: %APP_EXIT%
pause
exit /b %APP_EXIT%

:failed
echo Startup failed.
if "%~1"=="--check" exit /b 1
pause
exit /b 1
