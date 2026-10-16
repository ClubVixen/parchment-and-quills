@echo off
rem Starts Parchment & Quills and opens it in your browser.
cd /d "%~dp0app"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :fail
)
if not exist web\dist\index.html (
  echo Building the interface...
  call npm run build || goto :fail
)
start "" http://127.0.0.1:8787
echo Other computers on your network: http://%COMPUTERNAME%:8787  (or this PC's IP, e.g. http://192.168.0.106:8787)
rem Listen on the local network so other computers can open the app.
set NC_HOST=0.0.0.0
node server\index.js
goto :eof
:fail
echo Setup failed. See the messages above.
pause
