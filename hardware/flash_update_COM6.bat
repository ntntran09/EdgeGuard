@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BIN=%ROOT%build\EdgeGuardDevice.ino.bin"
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

rem Firmware update only: address 0x10000 is the app partition.
rem This deliberately leaves the NVS partition at 0x9000 untouched so the
rem cached RFID allowlist and access settings survive firmware updates.
rem Put GPIO0 to GND, reset the ESP32-CAM, then run this script.
echo [Flash] Updating firmware on %PORT% while preserving RFID NVS...
py -m esptool --chip esp32 --port %PORT% --baud 115200 --before default-reset --after hard-reset --no-stub write-flash --flash-mode dio --flash-freq 40m --flash-size 4MB 0x10000 "%BIN%"

endlocal
