@echo off
REM One-click way to push this whole project to your GitHub repo.
REM Safe to run more than once — the first run creates the local git repo and pushes
REM everything; every run after that just commits and pushes whatever changed since.
setlocal

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git is not installed, or not available from this terminal.
  echo Install it from https://git-scm.com/download/win, then run this file again.
  pause
  exit /b 1
)

if not exist ".git" (
  echo Initializing local git repository...
  git init
  git branch -M main
)

REM Fallback commit identity — only used if you don't already have one configured
REM (globally or in this repo). Doesn't touch/override anything you already have set.
git config user.name >nul 2>nul
if errorlevel 1 git config user.name "Qusai"
git config user.email >nul 2>nul
if errorlevel 1 git config user.email "qujaradat@asaltech.com"

REM Point "origin" at your repo — works whether this is the first run or a later one.
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin https://github.com/qusaijaradat/hesbah.git
) else (
  git remote set-url origin https://github.com/qusaijaradat/hesbah.git
)

git add -A
git commit -m "Update GreenMarket project"
if errorlevel 1 echo (No new changes to commit — will still push whatever's already committed.)

echo.
echo Pushing to https://github.com/qusaijaradat/hesbah ...
echo If a browser window pops up asking you to sign in to GitHub, sign in there and this will continue.
git push -u origin main

if errorlevel 1 (
  echo.
  echo [ERROR] Push failed. Common reasons:
  echo   - You weren't signed in yet: finish the sign-in in the browser window, then run this file again.
  echo   - The repo online already has commits that conflict — tell Claude and it'll help sort it out.
  pause
  exit /b 1
)

echo.
echo Done! Your project is now on GitHub: https://github.com/qusaijaradat/hesbah
pause
