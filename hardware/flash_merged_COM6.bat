@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BIN=%ROOT%build\EdgeGuardDevice.ino.merged.bin"
set "PORT=%~1"
if not defined PORT set "PORT=COM9"

if not exist "%BIN%" (
  echo [ERROR] Missing: %BIN%
  echo Run build_merged.bat first.
  exit /b 1
)

where py >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python launcher 'py' was not found.
  exit /b 1
)

rem Put GPIO0 to GND, reset the ESP32-CAM, then run this script.
rem --no-stub is intentionally used because this board previously failed while uploading the stub.
echo [Flash] Performing full flash on %PORT%. This clears RFID NVS.
py -m esptool --chip esp32 --port %PORT% --baud 115200 --before default-reset --after hard-reset --no-stub write-flash --flash-mode dio --flash-freq 40m --flash-size 4MB 0x0 "%BIN%"

endlocal
