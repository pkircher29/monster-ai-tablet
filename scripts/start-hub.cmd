@echo off
setlocal

cd /d "%~dp0.."

set "MONSTER_HUB_HOST=127.0.0.1"
set "MONSTER_HUB_PORT=8790"

if not exist "apps\hub-server\dist\cli.js" (
  echo Monster Agent Hub build is missing. Run npm run build first. 1>&2
  exit /b 2
)

if not exist "output" mkdir "output"

"C:\Program Files\nodejs\node.exe" "apps\hub-server\dist\cli.js" >> "output\hub-server.log" 2>&1
