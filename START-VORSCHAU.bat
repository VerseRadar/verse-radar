@echo off
title Verse Radar - Lokale Vorschau
cd /d "%~dp0"

REM Python ist nicht erforderlich. Die Vorschau nutzt Windows PowerShell.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-VORSCHAU.ps1"

pause
