@echo off
cd /d "%~dp0"
call git pull
call pnpm run build
start "" http://localhost:7080
node server\http-server.js
