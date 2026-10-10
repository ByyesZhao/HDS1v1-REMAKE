@echo off
setlocal
title HDSI Remake - Safe Stop
cd /d "%~dp0runtime"
if errorlevel 1 goto failed
node.exe stop.cjs
if errorlevel 1 goto failed
echo.
pause
exit /b 0
:failed
echo Safe stop failed. Check the HDSI console; no process was force-killed.
pause
exit /b 1
