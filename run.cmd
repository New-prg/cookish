@echo off
REM Wrapper so run works when PowerShell ExecutionPolicy blocks .ps1 scripts.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
exit /b %ERRORLEVEL%
