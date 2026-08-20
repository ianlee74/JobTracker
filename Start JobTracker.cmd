@echo off
cd /d "%~dp0"
if not exist dist\index.html (
  echo Building UI...
  call npm run build
)
start "" http://localhost:7080
node server\http-server.js
