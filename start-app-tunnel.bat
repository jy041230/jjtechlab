@echo off
setlocal

cd /d "%~dp0"
set "npm_config_cache=%~dp0.npm-cache"

echo.
echo [1/2] Starting plum measure app on http://localhost:5174 ...
start "Plum Measure App - Local Server" cmd /k "cd /d %~dp0 && node scripts\dev-server.mjs"

echo.
echo Waiting a few seconds before opening the tunnel...
timeout /t 5 /nobreak > nul

echo.
echo [2/2] Starting temporary public tunnel...
echo When the tunnel window shows "your url is: https://....loca.lt", use that address on the phone.
start "Plum Measure App - Public Tunnel" cmd /k "cd /d %~dp0 && npx.cmd --yes localtunnel --port 5174"

echo.
echo Local PC: http://localhost:5174
echo Same Wi-Fi phone: http://192.168.219.102:5174
echo Public tunnel: check the second window for the https://....loca.lt address
echo.
pause
