@echo off
chcp 65001 >nul
title Game Balance Lab V1.6
cd /d "%~dp0dist"
where py >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python launcher not found. Please install Python or run this folder with another static web server.
  pause
  exit /b 1
)
echo Game Balance Lab V1.6
 echo Open: http://localhost:8000/
 echo To stop: press Ctrl+C in this window.
start "" "http://localhost:8000/"
py -m http.server 8000
pause
