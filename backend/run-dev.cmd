@echo off
REM One-click way to start the backend correctly every time.
REM Forces ASPNETCORE_ENVIRONMENT=Development for this run, regardless of whatever
REM value might already be set system-wide on this machine (that's what caused the
REM "Jwt:SigningKey is still the placeholder value" error — some other value was
REM overriding the one launchSettings.json tries to set).
REM
REM Usage: just double-click this file, or run it from a terminal:
REM   run-dev.cmd

set ASPNETCORE_ENVIRONMENT=Development
cd /d "%~dp0"
dotnet run --project src\GreenMarket.Api
pause
