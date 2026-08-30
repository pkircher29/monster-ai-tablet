@echo off
node -v >nul 2>&1
if %errorlevel% neq 0 (
  echo Error: Node.js (v18+) is required. Please install from https://nodejs.org
  pause
  exit /b 1
)
echo Starting AI-Spy Console at http://localhost:4177 ...
start http://localhost:4177
node server.mjs
pause
