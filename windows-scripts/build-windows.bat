@echo off
setlocal EnableDelayedExtensions EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Build Installer
::  مطاعم الشرفة العالمي
::  ============================================================
::  يبني تطبيق Electron لويندوز بصيغتين:
::    - NSIS installer (.exe) — للنشر الرسمي
::    - Portable (.exe) — نسخة محمولة بدون تثبيت
::
::  المتطلبات:
::    - Node.js 18+
::    - تم تشغيل setup-windows.bat أولاً
::    - مساحة فارغة ~1 GB على القرص
::
::  الاستخدام:
::    build-windows.bat              ← يبني النسختين
::    build-windows.bat nsis         ← NSIS فقط
::    build-windows.bat portable     ← Portable فقط
::    build-windows.bat clean        ← ينظف ملفات البناء
::
::  المخرجات في: release/
::    - Karim-ERP-Setup-4.7.0.exe     (NSIS installer)
::    - Karim-ERP-Portable-4.7.0.exe  (Portable)
:: ============================================================

:: Project root (parent of windows-scripts) — portable on any machine/path
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-build.log"
echo. > "%LOG%" 2>nul
echo [%date% %time%] Build v4.7.0 started >> "%LOG%"

title karim ERP v4.7.0 - Build

echo.
echo ============================================================
echo   karim ERP v4.7.0 - Build
echo ============================================================
echo.

:: ─── Check prerequisites ──────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed.
    echo Run setup-windows.bat first.
    echo [%time%] FAIL: Node.js missing >> "%LOG%"
    pause
    exit /b 1
)

if not exist node_modules (
    echo ERROR: node_modules not found. Run setup-windows.bat first.
    pause
    exit /b 1
)

if exist .env goto env_ok
echo WARNING: .env not found. Creating from .env.example...
if not exist .env.example (
    echo ERROR: .env.example not found.
    pause
    exit /b 1
)
copy .env.example .env >nul
echo       .env created.
:env_ok

:: ─── Determine build type ─────────────────────
set "BUILD_TYPE=%~1"
if "%BUILD_TYPE%"=="" set "BUILD_TYPE=all"
if "%BUILD_TYPE%"=="clean" goto :clean
if "%BUILD_TYPE%"=="nsis" goto :build-nsis
if "%BUILD_TYPE%"=="portable" goto :build-portable
goto :all

:clean
echo [CLEAN] Cleaning release/ directory...
if exist release rmdir /s /q release
echo [CLEAN] Done.
echo [%time%] Clean >> "%LOG%"
exit /b 0

:build-nsis
echo [NSIS] Building NSIS installer...
echo        Target: release/Karim-ERP-Setup-4.7.0.exe
call npm run electron:build:nsis 2>nul
if errorlevel 1 (
    echo ERROR: NSIS build failed.
    echo [%time%] FAIL: NSIS >> "%LOG%"
    pause
    exit /b 1
)
echo        NSIS installer created ✅
echo [%time%] NSIS built >> "%LOG%"
goto :done

:build-portable
echo [PORTABLE] Building Portable version...
echo         Target: release/Karim-ERP-Portable-4.7.0.exe
call npm run electron:build:portable 2>nul
if errorlevel 1 (
    echo ERROR: Portable build failed.
    echo [%time%] FAIL: Portable >> "%LOG%"
    pause
    exit /b 1
)
echo         Portable created ✅
echo [%time%] Portable built >> "%LOG%"
goto :done

:all
echo [ALL] Building both NSIS + Portable...
echo        This may take 5-10 minutes...
echo.

echo [1/2] NSIS installer...
call npm run electron:build:nsis 2>nul
if errorlevel 1 (
    echo WARNING: NSIS build failed. Continuing with Portable...
)
echo        NSIS: done.
echo [2/2] Portable...
call npm run electron:build:portable 2>nul
if errorlevel 1 (
    echo WARNING: Portable build failed.
    echo [%time%] FAIL: Portable >> "%LOG%"
    pause
    exit /b 1
)
echo        Portable: done.
echo [%time%] Both built >> "%LOG%"

:done
:: ─── Summary ──────────────────────────────────
echo.
echo ============================================================
echo   Build complete ✅
echo ============================================================
echo.
echo Output in: release/
echo   - Karim-ERP-Setup-4.7.0.exe    (NSIS installer)
echo   - Karim-ERP-Portable-4.7.0.exe  (Portable)
echo.
echo Log: %LOG%
echo.
exit /b 0
