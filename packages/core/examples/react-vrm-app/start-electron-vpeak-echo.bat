@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM Starts vpeakserver (-echo-requests) + Vite + Electron via npm.
REM To use a different vpeakserver folder, set before running, e.g.:
REM   set VPEAKSERVER_ROOT=D:\path\to\vpeakserver

where npm >nul 2>&1
if errorlevel 1 (
  echo [error] npm not found in PATH. Install Node.js or add npm to PATH.
  exit /b 1
)

call npm run electron:with-vpeak:echo
exit /b %ERRORLEVEL%
