@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "SKETCH=%ROOT%EdgeGuardDevice"
set "LIBS=%ROOT%libraries"
set "OUT=%ROOT%build"
set "ESP32_URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json"
set "FQBN=esp32:esp32:esp32cam"

where arduino-cli >nul 2>&1
if errorlevel 1 (
  echo [ERROR] arduino-cli was not found in PATH.
  echo Install Arduino CLI, then reopen Command Prompt and run this file again.
  exit /b 1
)

if not exist "%OUT%" mkdir "%OUT%"

echo [1/4] Updating package index...
arduino-cli core update-index --additional-urls "%ESP32_URL%" || exit /b 1

echo [2/4] Installing ESP32 core 3.3.10 if needed...
arduino-cli core install esp32:esp32@3.3.10 --additional-urls "%ESP32_URL%" || exit /b 1

echo [3/4] Installing regular dependencies...
arduino-cli lib install "ArduinoJson@7.4.3" "PubSubClient@2.8" "ESP32Servo@3.2.1" || exit /b 1

echo [4/4] Compiling AI Thinker ESP32-CAM and creating merged binary...
arduino-cli compile --clean --fqbn "%FQBN%" --libraries "%LIBS%" --output-dir "%OUT%" "%SKETCH%" || exit /b 1

echo.
echo Build completed.
echo Expected merged file:
echo   %OUT%\EdgeGuardDevice.ino.merged.bin
endlocal
