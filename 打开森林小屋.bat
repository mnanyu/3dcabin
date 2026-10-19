@echo off
cd /d "%~dp0"
for %%f in (*.html) do (
  if /I not "%%~nxf"=="index.html" start "" "%%~ff"
)
