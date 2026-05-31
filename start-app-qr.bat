@echo off
setlocal
cd /d "%~dp0"
set "npm_config_cache=%~dp0.npm-cache"
set "TUNNEL_URL=https://jjtechlab-plum.loca.lt"

echo.
echo [1/3] Starting plum measure app on http://localhost:5174 ...
start "Plum Measure App - Local Server" cmd /k "cd /d %~dp0 && node scripts\dev-server.mjs"

echo.
echo Waiting a few seconds before opening the tunnel...
timeout /t 5 /nobreak > nul

echo.
echo [2/3] Starting HTTPS tunnel:
echo %TUNNEL_URL%
start "Plum Measure App - Public Tunnel" cmd /k "cd /d %~dp0 && npx.cmd --yes localtunnel --port 5174 --subdomain jjtechlab-plum"

echo.
echo [3/3] Opening QR code in your PC browser...
start "" "https://quickchart.io/qr?size=300&text=https%%3A%%2F%%2Fjjtechlab-plum.loca.lt"

echo.
echo Phone URL:
echo %TUNNEL_URL%
echo.
echo IMPORTANT:
echo Keep both black command windows open.
echo If localtunnel shows an IP confirmation page, enter the IP shown there.
echo.
pause
