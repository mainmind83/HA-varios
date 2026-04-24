# Beca BHT-18GCLZB-FL — Zigbee2MQTT external converter

[![Z2M version](https://img.shields.io/badge/Zigbee2MQTT-2.9%2B-blue)](https://www.zigbee2mqtt.io/)
[![HA version](https://img.shields.io/badge/HA-2024.6%2B-blue)](https://www.home-assistant.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/mainmind83/HA-varios/blob/main/LICENSE)

🇪🇸 **[Disponible también en español — README_es.md](./README_es.md)**

External converter for [Zigbee2MQTT](https://www.zigbee2mqtt.io/) that extends support for the Beca BHT-18GCLZB-FL Zigbee thermostat (`_TZE204_ttnvdkiz` / `TS0601`) well beyond the 4 basic datapoints exposed by the initial community converters.

## What problem does it solve?

Until now this device had no official support in Z2M and the external converters available exposed only 4 datapoints: ON/OFF, current temperature, setpoint, and relay state. That is enough to use it as a "dumb" sensor+switch but leaves most of the thermostat's functionality unreachable from Home Assistant.

On 2026-04-21, Becasmart shared the official *MCU SDK Quick Start Guide* for Tuya product `ttnvdkiz` directly, which documents the 21 datapoints the firmware exposes. This converter maps them following that specification while preserving the empirically validated mappings from the original community converter.

### Comparison with other converters

| Approach | Basic control | Calibration | Manual/schedule | Hysteresis | ECO mode | Floor sensor | Protections |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Generic `TS0601` converter | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Community 4-DP converter | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **This converter** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## What it adds

- **Temperature calibration** (DP 19) — ±9 °C, exposed through the native `climate` widget.
- **Manual / weekly schedule preset** (DP 109) — fixes the common mistake of targeting DP 2.
- **Blind spot / internal hysteresis** (DP 111) — **key when the thermostat drives a modulating heat pump**: a 1–2 °C deadzone avoids short-cycling the compressor.
- **ECO mode** with separate heat (DP 110) and cool (DP 108) setpoints.
- **Sensor selection** (DP 32): internal / external floor / both.
- **Setpoint bounds** (DP 18 lower, DP 34 upper) — physical limits on the thermostat itself.
- **Frost and over-temperature protections** (DP 120, DP 121).
- **Child lock** (DP 39) plus half/full lock mode (DP 115).
- **Standby brightness** for day (DP 117) and night (DP 118).

## Installation

### Step 1 — Download the converter

Download [`bht18.js`](./bht18.js) to your Zigbee2MQTT config folder, typically:

```
/config/zigbee2mqtt/bht18.js
```

### Step 2 — Register it as external converter

In `configuration.yaml` of Zigbee2MQTT add:

```yaml
external_converters:
  - bht18.js
```

### Step 3 — Restart Z2M and re-pair the device

Restart Zigbee2MQTT, then remove the device from Z2M and re-pair it so the new entities are created.

### Verification

After pairing, the device should expose in Home Assistant:

- `climate.<name>` with temperature, setpoint and `local_temperature_calibration`.
- `switch.<name>` for thermostat ON/OFF.
- `binary_sensor.<name>_relay_state` — use this as the demand source for your heating system.
- A set of configuration entities: `preset`, `eco_mode`, `deadzone_temperature`, `sensor_selection`, etc.

## Datapoint reference

### Empirically verified

| DP | Function | Verified | Status |
| --- | --- | --- | --- |
| 1 | ON/OFF | April 2026 | ✅ read/write |
| 2 | Working mode (`hot`/`cold`) | April 2026 | ✅ read/write (confirmed 24/04 after adding official mapping) |
| 16 | Current temperature | April 2026 | ✅ read |
| 47 | Relay state (`0`=ON, `1`=OFF) | April 2026 | ✅ read |
| 50 | Target setpoint | April 2026 | ✅ read/write |

> **Note on DP 2:** initial testing (15–17 April 2026) declared DP 2 "non-functional over Zigbee". That conclusion was wrong: the test ran without DP 2 being mapped in the converter, so Z2M silently ignored writes and couldn't decode reads. Once the official mapping (`enum: cold=0x00, hot=0x01`) was added per the manufacturer's PDF, bidirectional read/write confirmed on 24 April 2026.

### Added from the manufacturer's official PDF

| DP | Z2M key | Type | Notes |
| --- | --- | --- | --- |
| 18 | `min_temperature_limit` | numeric | Floor-temp lower limit, ÷10 |
| 19 | `local_temperature_calibration` | signed | ±9 °C, integrated in `climate` widget |
| 32 | `sensor_selection` | enum | `in` / `out` / `inout` |
| 34 | `max_temperature_limit` | numeric | Setpoint ceiling, ÷10 |
| 39 | `child_lock` | binary | |
| 40 | `eco_mode` | binary | |
| 108 | `eco_cool_temp` | numeric | Range 10–30, no divisor |
| 109 | `preset` | enum | `schedule` / `manual` |
| 110 | `eco_heat_temp` | numeric | Range 10–30, no divisor |
| 111 | `deadzone_temperature` | numeric | **Blind spot, 1–5 °C** |
| 112 | `floor_temperature` | numeric | Reports `0` when no external NTC is connected |
| 114 | `display_setpoint_only` | binary | |
| 115 | `lock_mode` | enum | `half` / `full` |
| 117 | `brightness_day` | numeric | 0–8 |
| 118 | `brightness_night` | numeric | 0–8 |
| 120 | `frost_protection_temperature` | numeric | 0–10 °C |
| 121 | `high_protection_temperature` | numeric | 25–70 °C |

### Intentionally unmapped

| DP | Function | Reason |
| --- | --- | --- |
| 28 | Factory reset | Intentionally not exposed for safety |
| 101–107 | Weekly schedule (7 days, raw 128-byte blocks) | Complex format, needs a dedicated schedule converter similar to `ZWT198_schedule`. Could be added in a future version. |

## Confirming new DPs on your unit

Firmware variations across Tuya OEM devices with the same PID are common. If a DP doesn't respond as expected, enable [Z2M debug logging](https://www.zigbee2mqtt.io/guide/configuration/logging.html) and watch for lines like:

```
Datapoint 'X' with value 'Y' not defined for '_TZE204_ttnvdkiz'
```

If you find a mapping correction or want to confirm behavior of a specific DP, please open an issue — a DP confirmation template is available at [`dp_confirmation_template.md`](./dp_confirmation_template.md).

## Manufacturer documentation

This converter is based on the official *MCU SDK Quick Start Guide* for Tuya product `ttnvdkiz`, shared privately by the manufacturer (Beca / Xiamen Beca Energysaving Technology Co., Ltd) on 2026-04-21.

The PDF is not republished in this repository as public redistribution permission was not granted. If you need access to the document for your own integration work, contact Becasmart directly — they have been responsive to technical requests. The datapoint table in this README reproduces the DP IDs, types and ranges as documented, which is the information needed to understand and extend the converter.

## Upstream context

- Original Z2M support issue: [Koenkk/zigbee2mqtt#31736](https://github.com/Koenkk/zigbee2mqtt/issues/31736)
- Official Z2M guide for Tuya devices: [Support new Tuya devices](https://www.zigbee2mqtt.io/advanced/support-new-devices/02_support_new_tuya_devices.html)
- zigbee-herdsman-converters: [src/lib/tuya.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/lib/tuya.ts) — reference for `valueConverter` implementations

Once all newly-added DPs are empirically validated, the intention is to open a PR against `zigbee-herdsman-converters` to integrate this support into the official Z2M distribution.

## License

MIT for the converter code. The manufacturer's PDF is **not** redistributed — only the publicly relevant datapoint information (IDs, types, ranges) is reproduced in this README for technical reference.
