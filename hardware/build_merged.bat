@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "SKETCH=%ROOT%EdgeGuardDevice"
set "PN532_LIB=%ROOT%libraries\PN532-arduino\PN532-arduino"
set "NDEF_LIB=%ROOT%libraries\NDEF-master\NDEF-master"
set "FOMO_LIB=%ROOT%libraries\ESP32-CAM_Detection_FOMO_inferencing"
set "OUT=%ROOT%build"
set "ESP32_URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json"
set "ESP32_CORE_VERSION=2.0.17"
set "ESPTOOL_VERSION=4.5.1"
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

echo [1/5] Updating package index...
"%CLI%" core update-index --additional-urls "%ESP32_URL%" || exit /b 1

echo [2/5] Installing ESP32 core %ESP32_CORE_VERSION% required by the Edge Impulse library...
"%CLI%" core install esp32:esp32@%ESP32_CORE_VERSION% --additional-urls "%ESP32_URL%" || exit /b 1

echo [3/5] Installing regular dependencies...
"%CLI%" lib install "ArduinoJson@7.4.3" "PubSubClient@2.8" "ESP32Servo@3.2.1" || exit /b 1

echo [4/5] Compiling AI Thinker ESP32-CAM...
"%CLI%" compile --clean --fqbn "%FQBN%" --library "%PN532_LIB%" --library "%NDEF_LIB%" --library "%FOMO_LIB%" --output-dir "%OUT%" "%SKETCH%" || exit /b 1

set "ARDUINO_DATA=%LOCALAPPDATA%\Arduino15"
if defined ARDUINO_DIRECTORIES_DATA set "ARDUINO_DATA=%ARDUINO_DIRECTORIES_DATA%"
set "ESPTOOL=%ARDUINO_DATA%\packages\esp32\tools\esptool_py\%ESPTOOL_VERSION%\esptool.exe"
set "BOOT_APP0=%ARDUINO_DATA%\packages\esp32\hardware\esp32\%ESP32_CORE_VERSION%\tools\partitions\boot_app0.bin"

if not exist "%ESPTOOL%" (
  echo [ERROR] Missing esptool: %ESPTOOL%
  exit /b 1
)
if not exist "%BOOT_APP0%" (
  echo [ERROR] Missing boot_app0.bin: %BOOT_APP0%
  exit /b 1
)

echo [5/5] Creating 4 MB merged binary...
"%ESPTOOL%" --chip esp32 merge_bin --flash_mode dio --flash_freq keep --flash_size 4MB --fill-flash-size 4MB -o "%OUT%\EdgeGuardDevice.ino.merged.bin" 0x1000 "%OUT%\EdgeGuardDevice.ino.bootloader.bin" 0x8000 "%OUT%\EdgeGuardDevice.ino.partitions.bin" 0xe000 "%BOOT_APP0%" 0x10000 "%OUT%\EdgeGuardDevice.ino.bin" || exit /b 1

echo.
echo Build completed.
echo Expected merged file:
echo   %OUT%\EdgeGuardDevice.ino.merged.bin
endlocal
