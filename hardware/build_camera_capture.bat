@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "SKETCH=%ROOT%CameraCapture"
set "OUT=%ROOT%build\CameraCapture"
set "ESP32_URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json"
set "ESP32_CORE_VERSION=2.0.17"
set "FQBN=esp32:esp32:esp32cam"
set "CLI=arduino-cli"

where arduino-cli >nul 2>&1
if errorlevel 1 (
  if exist "%ROOT%bin\arduino-cli.exe" (
    set "CLI=%ROOT%bin\arduino-cli.exe"
  ) else (
    echo [ERROR] arduino-cli was not found in PATH or hardware\bin.
    exit /b 1
  )
)

if not exist "%OUT%" mkdir "%OUT%"

echo [1/4] Updating the ESP32 package index...
"%CLI%" core update-index --additional-urls "%ESP32_URL%" || exit /b 1

echo [2/4] Installing ESP32 core %ESP32_CORE_VERSION%...
"%CLI%" core install esp32:esp32@%ESP32_CORE_VERSION% --additional-urls "%ESP32_URL%" || exit /b 1

echo [3/4] Installing firmware dependencies...
"%CLI%" lib install "ArduinoJson@7.4.3" || exit /b 1

echo [4/4] Compiling standalone CameraCapture firmware...
"%CLI%" compile --clean --fqbn "%FQBN%" --output-dir "%OUT%" "%SKETCH%" || exit /b 1

echo.
echo Build completed.
echo Firmware files are in:
echo   %OUT%
endlocal
