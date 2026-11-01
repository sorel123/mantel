@echo off
rem Starts the Mantel server. The "Mantel server" scheduled task runs this at boot.
rem Data lives in %ProgramData%\Mantel\data. A .env file in %ProgramData%\Mantel is read too
rem (advanced settings; everything normal is set up inside the app).
set "APPDIR=%~dp0"
set "DATA_DIR=%ProgramData%\Mantel\data"
set "DISPLAY_DIST=%APPDIR%app\display"
set "NODE_ENV=production"
set "HOST=0.0.0.0"
set "PORT=8787"
set "LOCAL_PAIR=1"
rem The tray icon's "Change port" writes the number to port.txt.
if exist "%ProgramData%\Mantel\port.txt" set /p PORT=<"%ProgramData%\Mantel\port.txt"
if not exist "%ProgramData%\Mantel\data" mkdir "%ProgramData%\Mantel\data"
cd /d "%ProgramData%\Mantel"
"%APPDIR%node.exe" "%APPDIR%app\dist\index.js" >> "%ProgramData%\Mantel\server.log" 2>&1
