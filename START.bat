@echo off
echo.
echo  Starting NoteCraft AI...
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo  Dependencies not installed. Running setup first...
    call setup.bat
)

REM Check if server.mjs exists
if not exist "server.mjs" (
    echo  [ERROR] server.mjs not found!
    echo  Make sure you're running this from the NoteCraft AI directory.
    pause
    exit /b 1
)

REM Start server and open browser
echo  Starting server on http://localhost:3000
echo.

start "" http://localhost:3000
node server.mjs

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERROR] Server failed to start!
    echo  Check the error above for details.
    pause
)
