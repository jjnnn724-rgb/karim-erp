@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Test Suite (portable wrapper)
::  Delegates to npm scripts (single source of truth).
::  Usage: test-windows.bat [jest|smoke|integration|pos|all]
:: ============================================================

:: Project root (parent of windows-scripts)
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-test.log"
echo. > "%LOG%" 2>nul

title karim ERP v4.7.0 - Tests

echo.
echo ============================================================
echo   karim ERP v4.7.0 - Test Suite
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 ( echo ERROR: Node.js not installed. & pause & exit /b 1 )
if not exist node_modules ( echo ERROR: node_modules missing. Run Setup first. & pause & exit /b 1 )

set "SUITE=%~1"
if "%SUITE%"=="" set "SUITE=all"

if /i "%SUITE%"=="all" goto t_all
if /i "%SUITE%"=="jest" goto t_jest
if /i "%SUITE%"=="smoke" goto t_smoke
if /i "%SUITE%"=="integration" goto t_int
if /i "%SUITE%"=="pos" goto t_pos
echo Unknown suite: %SUITE%  (jest/smoke/integration/pos/all)
exit /b 1

:t_all
echo [1/2] Lint + format + unit...
call npm run test:all
if errorlevel 1 goto failed
echo [2/2] Smoke...
call npm run smoke
goto done_rc

:t_jest
call npm test
goto done_rc

:t_smoke
call npm run smoke
goto done_rc

:t_int
call npm run integration
goto done_rc

:t_pos
call npm run pos-sale
goto done_rc

:failed
echo FAILED — see output above.
exit /b 1

:done_rc
set "RC=%errorlevel%"
echo [%time%] exit=%RC% >> "%LOG%"
echo.
if not "%RC%"=="0" ( echo FAILED — log: %LOG% & pause )
exit /b %RC%
