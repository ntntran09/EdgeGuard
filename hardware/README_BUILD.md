# EdgeGuardDevice - fixed PN532 I2C build

## What was fixed

1. Enables `NFC_INTERFACE_I2C` and includes `PN532_I2C.cpp`, as required by the supplied PN532-Arduino ZIP.
2. Keeps PN532 scanning even when MQTT is offline.
3. Makes Wi-Fi/MQTT reconnect attempts non-blocking, so camera/PN532/servo loops are not frozen by a bad network or broker.
4. Checks `SAMConfig()`, validates UID length, and limits passive-target retries.
5. Uses a bounded JSON serialization buffer.

The supplied NDEF library is bundled because PN532-Arduino declares it as a dependency, but this firmware only reads ISO14443A UID values. It does not parse or write NDEF records.

## Build with Arduino IDE 2

1. Install ESP32 board package and select **AI Thinker ESP32-CAM**.
2. Install ZIP libraries `PN532-arduino.zip` and `NDEF-master.zip` if compiling the standalone sketch outside this bundle.
3. Install `ArduinoJson`, `PubSubClient`, and `ESP32Servo` from Library Manager.
4. Open `EdgeGuardDevice/EdgeGuardDevice.ino`.
5. Use **Sketch > Export Compiled Binary**.
6. Find `EdgeGuardDevice.ino.merged.bin` in the sketch/build output.

## Build from Command Prompt

Install Arduino CLI and put `arduino-cli.exe` in PATH, then run:

```bat
build_merged.bat
```

The result should be:

```text
build\EdgeGuardDevice.ino.merged.bin
```

## Flash the merged binary

1. Connect GPIO0 to GND.
2. Reset/power-cycle the ESP32-CAM into download mode.
3. Confirm the port in `flash_merged_COM6.bat`.
4. Run the script.
5. Disconnect GPIO0 from GND and reset to boot normally.

The merged binary must be written at address `0x0`.

## Expected boot workflow

1. Serial, status LED, camera, servo/buzzer, PN532 and networking are initialized.
2. Wi-Fi and MQTT reconnect in the background rather than blocking setup/loop.
3. PN532 continuously checks ISO14443A cards and prints UIDs to Serial.
4. When MQTT is online, the UID is published to `/EdgeGuard/device_001/telemetry/nfc`.
5. Camera publishes a binary JPEG every 10 seconds to `/EdgeGuard/device_001/image`.
6. System metrics publish every 10 seconds.
7. MQTT commands can control buzzer, servo, config and reboot.

## Hardware cautions

- PN532 must be physically set to I2C mode and normally answers at 7-bit address `0x24`.
- GPIO12 and GPIO15 are ESP32 strapping pins; servo/buzzer circuits must not force an invalid level during reset.
- GPIO13/14/15 overlap the microSD interface, so do not use the SD card with this pin assignment.
- Power the servo from a separate 5 V supply with common GND. Camera + Wi-Fi + servo current spikes can brown out the ESP32-CAM.
