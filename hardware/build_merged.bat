@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "SKETCH=%ROOT%EdgeGuardDevice"
set "PN532_LIB=%ROOT%libraries\PN532-arduino\PN532-arduino"
set "NDEF_LIB=%ROOT%libraries\NDEF-master\NDEF-master"
set "OUT=%ROOT%build"
set "ESP32_URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json"
set "FQBN=esp32:esp32:esp32cam"
set "CLI=arduino-cli"

where arduino-cli >nul 2>&1
if errorlevel 1 (
  if exist "%ROOT%bin\arduino-cli.exe" (
    set "CLI=%ROOT%bin\arduino-cli.exe"
  ) else (
    echo [ERROR] arduino-cli was not found in PATH or hardware\bin.
    echo Install Arduino CLI, then reopen Command Prompt and run this file again.
    exit /b 1
  )
)

if not exist "%OUT%" mkdir "%OUT%"

echo [1/4] Updating package index...
"%CLI%" core update-index --additional-urls "%ESP32_URL%" || exit /b 1

echo [2/4] Installing ESP32 core 3.3.10 if needed...
"%CLI%" core install esp32:esp32@3.3.10 --additional-urls "%ESP32_URL%" || exit /b 1

echo [3/4] Installing regular dependencies...
"%CLI%" lib install "ArduinoJson@7.4.3" "PubSubClient@2.8" "ESP32Servo@3.2.1" || exit /b 1

echo [4/4] Compiling AI Thinker ESP32-CAM and creating merged binary...
"%CLI%" compile --clean --fqbn "%FQBN%" --library "%PN532_LIB%" --library "%NDEF_LIB%" --output-dir "%OUT%" "%SKETCH%" || exit /b 1

echo.
echo Build completed.
echo Expected merged file:
echo   %OUT%\EdgeGuardDevice.ino.merged.bin
endlocal
