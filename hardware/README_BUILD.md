# EdgeGuardDevice - fixed PN532 I2C build

## What was fixed

1. Enables `NFC_INTERFACE_I2C`; Arduino compiles the bundled `PN532_I2C.cpp` library source exactly once.
2. Keeps PN532 scanning even when MQTT is offline.
3. Makes Wi-Fi/MQTT reconnect attempts non-blocking, so camera/PN532/servo loops are not frozen by a bad network or broker.
4. Checks `SAMConfig()`, validates UID length, and limits passive-target retries.
5. Uses a bounded JSON serialization buffer.
6. Retries PN532 initialization every 10 seconds, so a late-powered or temporarily disconnected reader can recover without rebooting the ESP32-CAM.
7. Corrects the bundled PN532 driver's handling of successful zero-payload `SAMConfiguration` and `RFConfiguration` responses.
8. Runs auto-lock deadlines on the ESP32, using the Mini App's configured delay instead of a server timer.
9. Persists up to 32 active RFID/NFC UIDs in ESP32 NVS so authorized cards still open the door without Wi-Fi.
10. Latches each card presentation until the card is removed, preventing a held card from repeatedly extending auto-lock.
11. Handles the Mini App alarm command with a continuous alternating urgent buzzer tone until the alarm is turned off.
12. Opens cached active RFID cards locally even while Wi-Fi/MQTT still appears connected during an outage; MQTT is used for logging rather than gating the servo.
13. Publishes door state immediately after manual unlock/lock, RFID access, and auto-lock so the Mini App button follows the servo state.
14. Retries failed camera initialization/capture, serves QVGA `/capture` and `/stream` endpoints over HTTP, and announces those URLs through retained MQTT telemetry.
15. Runs the bundled 96 x 96 grayscale Edge Impulse FOMO model once per second when possible and detects `human`, `backpack`, and `package` objects.
16. Prints every FOMO bounding box and centroid above 70% confidence to Serial, then publishes those detections to `/EdgeGuard/device_001/model/inference` with `person`/`bag`/`package` aliases.
17. Uses separate LEDC timers for the servo, buzzer, and camera so RFID/alarm tones cannot stop the servo PWM signal.
18. Persists independent `camera_publish_enabled` and `ai_detection_enabled` switches from the retained MQTT device configuration, allowing the HTTP live view and FOMO inference to be stopped separately without disabling RFID or access control.

The supplied NDEF library is bundled because PN532-Arduino declares it as a dependency, but this firmware only reads ISO14443A UID values. It does not parse or write NDEF records.

## Build with Arduino IDE 2

1. Install ESP32 board package **2.0.17** and select **AI Thinker ESP32-CAM**. ESP32 core 3.3.10 bundles a conflicting TensorFlow Lite Micro runtime and cannot link this Edge Impulse export.
2. Install ZIP libraries `PN532-arduino.zip`, `NDEF-master.zip`, and `edgeguard_fomo_v1_96x96_gray_int8_eon.zip` if compiling the standalone sketch outside this bundle.
3. Install `ArduinoJson`, `PubSubClient`, and `ESP32Servo` from Library Manager.
4. Open `EdgeGuardDevice/EdgeGuardDevice.ino`.
5. Use **Sketch > Export Compiled Binary**.
6. Find `EdgeGuardDevice.ino.merged.bin` in the sketch/build output.

## Build from Command Prompt

Run the following command. The script uses `arduino-cli` from PATH, or the bundled `hardware/bin/arduino-cli.exe` as a fallback:

```bat
build_merged.bat
```

The result should be:

```text
build\EdgeGuardDevice.ino.merged.bin
```

## Flash firmware without deleting RFID cache

For normal firmware updates, use `flash_update_COM6.bat`. It writes only the app partition at `0x10000`, preserving the RFID allowlist and access settings stored in NVS.

1. Connect GPIO0 to GND.
2. Reset/power-cycle the ESP32-CAM into download mode.
3. Close Serial Monitor so the USB-UART port is free.
4. Run `flash_update_COM6.bat`. It now defaults to `COM9`; pass another port as the first argument when needed, for example `flash_update_COM6.bat COM8`.
5. Disconnect GPIO0 from GND and reset to boot normally.

## Factory/full flash

1. Connect GPIO0 to GND.
2. Reset/power-cycle the ESP32-CAM into download mode.
3. Confirm the port in `flash_merged_COM6.bat`.
4. Run the script.
5. Disconnect GPIO0 from GND and reset to boot normally.

The merged binary must be written at address `0x0`. Because it covers the full 4 MB flash, this also clears the NVS RFID cache. After a merged/full flash, let the device and Mini App backend connect once and wait for `[Device] Saved ... RFID card(s) to NVS` before testing offline access.

## Expected boot workflow

1. Serial, status LED, camera, servo/buzzer, PN532 and networking are initialized.
2. Wi-Fi and MQTT reconnect in the background rather than blocking setup/loop.
3. PN532 continuously checks ISO14443A cards and prints UIDs to Serial.
4. When MQTT is online, the UID is published to `/EdgeGuard/device_001/telemetry/nfc`.
5. Camera starts an HTTP server on port 81 and publishes `/capture`, `/stream`, and `/health` URLs to `/EdgeGuard/device_001/telemetry/endpoints`. The Mini App server polls `/capture`; camera frame bytes no longer need to pass through MQTT.
6. System metrics publish every 10 seconds.
7. MQTT commands can control buzzer, servo, config and reboot.
8. FOMO captures a separate QVGA frame, center-crops/resizes it to 96 x 96, and runs inference at a requested 1-second interval. The prototype model is estimated at about 1180 ms per inference, so the real interval cannot be shorter than the inference duration.

FOMO uses the model's original labels in `model_label` and each bounding box: `human`, `backpack`, and `package`. Only predictions strictly above 70% confidence are accepted. Each MQTT detection includes its bounding box and `centroid_x`/`centroid_y` in the 96 x 96 inference coordinate system. MQTT also supplies the friendlier `object_type` aliases `person`, `bag`, and `package`; the top-level `label` is `person_detected` or `object_detected` for Mini App event compatibility. Frames with no detections are printed to Serial but are not published, avoiding one empty database log per second.

Manual Mini App door commands move only the servo and do not sound the buzzer. RFID reads still use the short acknowledgement tone. Door-state changes publish immediately to `/EdgeGuard/device_001/telemetry/security`; periodic system telemetry also includes the current door and camera state.

After the firmware and Mini App backend are online together once, the backend publishes a retained access configuration. The ESP32 stores the auto-lock settings, servo angles, and active RFID/NFC allowlist in NVS. Later Wi-Fi outages do not erase those values. Add, enable, disable, or remove cards through the Mini App while online so the stored offline allowlist stays current.

The same retained configuration includes `camera_publish_enabled` and `ai_detection_enabled`. Both switches are persisted in NVS. `camera_publish_enabled` now controls access to the HTTP live camera while the camera remains available to FOMO when AI is enabled. Disabling AI stops FOMO inference and new AI logs while the live camera can continue independently.

At boot, Serial prints `[Device] Loaded RFID cache (...)`. Before testing without Wi-Fi, verify that this line contains the expected UID and is not `empty`. When a cached card is accepted, Serial prints `[PN532] Cached RFID access granted` followed by `[Servo] Unlocked ...`.

## Hardware cautions

- PN532 must be physically set to I2C mode and normally answers at 7-bit address `0x24`.
- GPIO12 and GPIO15 are ESP32 strapping pins; servo/buzzer circuits must not force an invalid level during reset.
- GPIO13/14/15 overlap the microSD interface, so do not use the SD card with this pin assignment.
- Power the servo from a separate 5 V supply with common GND. Camera + Wi-Fi + servo current spikes can brown out the ESP32-CAM.
