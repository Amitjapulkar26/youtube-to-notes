@echo off
setlocal EnableDelayedExpansion

echo.
echo ================================================
echo        NoteCraft AI - Setup Script
echo ================================================
echo.

set ERRORS=0
set WARNINGS=0

REM ---- Check Node.js ----
echo [1/7] Checking Node.js...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Node.js not found!
    echo   Download from: https://nodejs.org
    set /a ERRORS+=1
) else (
    for /f "tokens=*" %%v in ('node --version') do echo   [OK] Node.js %%v
)

REM ---- Check npm ----
echo [2/7] Checking npm...
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] npm not found!
    set /a ERRORS+=1
) else (
    for /f "tokens=*" %%v in ('npm --version') do echo   [OK] npm %%v
)

REM ---- Check Python ----
echo [3/7] Checking Python...
set PYTHON_CMD=
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PYTHON_CMD=python
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo   [OK] %%v
) else (
    where python3 >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set PYTHON_CMD=python3
        for /f "tokens=*" %%v in ('python3 --version 2^>^&1') do echo   [OK] %%v
    ) else (
        where py >nul 2>nul
        if %ERRORLEVEL% EQU 0 (
            set PYTHON_CMD=py
            for /f "tokens=*" %%v in ('py --version 2^>^&1') do echo   [OK] %%v
        ) else (
            echo   [WARN] Python not found in PATH
            echo   Whisper transcription will not be available
            set /a WARNINGS+=1
        )
    )
)

REM ---- Check FFmpeg ----
echo [4/7] Checking FFmpeg...
where ffmpeg >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [WARN] FFmpeg not found
    echo   Audio processing will not be available
    echo   Download from: https://ffmpeg.org/download.html
    set /a WARNINGS+=1
) else (
    echo   [OK] FFmpeg found
)

REM ---- Install npm packages ----
echo [5/7] Installing npm packages...
if exist "package.json" (
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo   [FAIL] npm install failed
        set /a ERRORS+=1
    ) else (
        echo   [OK] npm packages installed
    )
) else (
    echo   [FAIL] package.json not found!
    set /a ERRORS+=1
)

REM ---- Install Python packages ----
echo [6/7] Installing Python packages...
if defined PYTHON_CMD (
    echo   Installing yt-dlp...
    %PYTHON_CMD% -m pip install --quiet yt-dlp 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo   [OK] yt-dlp installed
    ) else (
        echo   [WARN] yt-dlp install failed - try: pip install yt-dlp
        set /a WARNINGS+=1
    )

    echo   Installing faster-whisper...
    %PYTHON_CMD% -m pip install --quiet faster-whisper 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo   [OK] faster-whisper installed
    ) else (
        echo   [WARN] faster-whisper install failed - try: pip install faster-whisper
        set /a WARNINGS+=1
    )
) else (
    echo   [SKIP] Python not available
)

REM ---- Verify yt-dlp ----
echo [7/7] Verifying yt-dlp...
where yt-dlp >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if defined PYTHON_CMD (
        %PYTHON_CMD% -m yt_dlp --version >nul 2>nul
        if %ERRORLEVEL% EQU 0 (
            echo   [OK] yt-dlp available via Python
        ) else (
            echo   [WARN] yt-dlp not found in PATH
            set /a WARNINGS+=1
        )
    ) else (
        echo   [WARN] yt-dlp not available
        set /a WARNINGS+=1
    )
) else (
    for /f "tokens=*" %%v in ('yt-dlp --version') do echo   [OK] yt-dlp %%v
)

REM ---- Create .env if not exists ----
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo.
        echo   [OK] Created .env from .env.example
    )
)

REM ---- Summary ----
echo.
echo ================================================
echo        NOTECRAFT AI SYSTEM CHECK
echo ================================================
echo.

if %ERRORS% GTR 0 (
    echo   Errors:   %ERRORS%
    echo   Warnings: %WARNINGS%
    echo.
    echo   Fix the errors above before running.
) else (
    if %WARNINGS% GTR 0 (
        echo   All required components OK!
        echo   Warnings: %WARNINGS% (optional features may not work)
    ) else (
        echo   All components ready!
    )
)
echo.
echo   Run START.bat to launch NoteCraft AI
echo.
echo ================================================

pause
