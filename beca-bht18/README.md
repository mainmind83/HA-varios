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

| Approach | Basic control | Calibration | Manual/schedule | Hysteresis | ECO mode | Floor sensor | Protections | Native climate card |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Generic `TS0601` converter | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Community 4-DP converter | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **This converter (v2)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ off / heat / cool |

## What it adds

- **Unified `climate.system_mode`** with `off / heat / cool` — single point of control that drives DP 1 (state) and DP 2 (working mode) coherently. The native Home Assistant `climate` card with the `climate-hvac-modes` feature works out of the box.
- **Temperature calibration** (DP 19) — ±9 °C, exposed through the native `climate` widget.
- **Manual / weekly schedule preset** (DP 109) — fixes the common mistake of targeting DP 2.
- **Blind spot / internal hysteresis** (DP 111) — **key when the thermostat drives a modulating heat pump**: a 1–2 °C deadzone avoids short-cycling the compressor.
- **ECO mode** with separate heat (DP 110) and cool (DP 108) setpoints.
- **Sensor selection** (DP 32): internal / external floor / both.
- **Setpoint bounds** (DP 18 lower, DP 34 upper) — physical limits on the thermostat itself.
- **Frost and over-temperature protections** (DP 120, DP 121).
- **Child lock** (DP 39) plus half/full lock mode (DP 115).
- **Standby brightness** for day (DP 117) and night (DP 118).

## Why a unified `system_mode`?

The thermostat firmware splits power and operating mode across two datapoints (DP 1 = on/off, DP 2 = cold/hot). Earlier versions of this converter exposed both as independent writable entities (`switch` + `working_mode`), which led to subtle desynchronization issues:

- Pressing the physical button caused `state` to update but not the derived `system_mode` (Z2M's `tuyaDatapoints` table only processes the first matching entry per DP, so a second auxiliary entry to publish the derived attribute was silently ignored).
- Writing to `state` or `working_mode` directly from Z2M bypassed the coordination logic and left the climate `hvac_mode` stale.

In v2, `climate.system_mode` becomes the **single writable entry point** for both DPs. Internally:

- `system_mode = off` → DP 1 = false (DP 2 untouched)
- `system_mode = heat` → DP 2 = `hot` + DP 1 = true
- `system_mode = cool` → DP 2 = `cold` + DP 1 = true

Reads from either DP recompute `system_mode` consistently, so any change source — physical button, Z2M frontend, HA card, automation — keeps everything in sync.

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

- `climate.<name>` with temperature, setpoint, `local_temperature_calibration` and `system_mode` (`off / heat / cool`) — this is the main control entity.
- `binary_sensor.<name>_relay_state` — the internal relay state (DP 47), useful as the demand source for your heating system.
- A set of configuration entities: `preset`, `eco_mode`, `deadzone_temperature`, `sensor_selection`, etc.

The native HA `climate` card with the `climate-hvac-modes` feature shows the off/heat/cool chips and they work bidirectionally:

```yaml
type: thermostat
entity: climate.dormitorio_termostato
features:
  - type: climate-hvac-modes
    hvac_modes:
      - heat
      - cool
      - "off"
```

## Migration from v1

Previous versions of this converter exposed `switch.<name>` and `select.<name>_working_mode` as independently writable entities. In v2 these are removed; the equivalent control happens through `climate.<name>.set_hvac_mode`.

| v1 (old) | v2 (new) |
| --- | --- |
| `switch.turn_on` on `switch.<name>` | `climate.set_hvac_mode` with `hvac_mode: heat` (or `cool`) |
| `switch.turn_off` on `switch.<name>` | `climate.set_hvac_mode` with `hvac_mode: "off"` |
| `select.select_option` on `select.<name>_working_mode` with `option: hot` | `climate.set_hvac_mode` with `hvac_mode: heat` |
| `select.select_option` on `select.<name>_working_mode` with `option: cold` | `climate.set_hvac_mode` with `hvac_mode: cool` |

### Example — automation update

Before:

```yaml
- service: switch.turn_on
  target:
    entity_id: switch.despacho_termostato
- service: select.select_option
  target:
    entity_id: select.despacho_termostato_working_mode
  data:
    option: hot
```

After:

```yaml
- service: climate.set_hvac_mode
  target:
    entity_id: climate.despacho_termostato
  data:
    hvac_mode: heat
```

If you have automations that still write to the old entities, they will fail silently after the upgrade — the entities no longer exist. Search your `/config` for `switch.<name>_termostato` and `select.<name>_working_mode` references and migrate them.

## Datapoint reference

### Empirically verified

| DP | Function | Verified | Status |
| --- | --- | --- | --- |
| 1 | ON/OFF general | April 2026 | ✅ controlled via `climate.system_mode` (off/heat/cool) |
| 2 | Working mode (`hot`/`cold`) | April 2026 | ✅ controlled via `climate.system_mode` (heat/cool) |
| 16 | Current temperature | April 2026 | ✅ read |
| 47 | Relay state (`0`=ON, `1`=OFF) | April 2026 | ✅ read (exposed as `relay_state` for diagnostics) |
| 50 | Target setpoint | April 2026 | ✅ read/write |

> **Note on DP 2:** initial testing (15–17 April 2026) declared DP 2 "non-functional over Zigbee". That conclusion was wrong: the test ran without DP 2 being mapped in the converter, so Z2M silently ignored writes and couldn't decode reads. Once the official mapping (`enum: cold=0x00, hot=0x01`) was added per the manufacturer's PDF, bidirectional read/write was confirmed on 24 April 2026.

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

## Changelog

### v2 — 2 May 2026

**Breaking change:** unified control through `climate.system_mode`.

- Added: `climate.system_mode` with values `off / heat / cool`. Native HA card chips work bidirectionally.
- Added: writes are coordinated — `system_mode = heat` sends DP 2 = hot then DP 1 = ON in a single transaction, etc.
- Added: reads are unified — physical button, Z2M frontend, HA service calls all keep the climate state coherent.
- Removed: `switch.<name>` (writable entity replaced by `system_mode`).
- Removed: `select.<name>_working_mode` (writable entity replaced by `system_mode`).
- Kept: `binary_sensor.<name>_relay_state` (DP 47) for diagnostics — it reports the internal relay contact, distinct from the on/off state, useful as a demand signal to the boiler / heat pump.

See "Migration from v1" above for automation update examples.

### v1 — 17 April 2026

Initial public release.

- Empirically verified DPs: 1, 16, 47, 50.
- 14 additional DPs added per the manufacturer's PDF (18, 19, 32, 34, 39, 40, 108, 109, 110, 111, 112, 114, 115, 117, 118, 120, 121).
- Note: DP 2 (working mode hot/cold) was initially declared non-functional; this was a converter mapping issue, corrected on 24 April 2026 once the official enum was added.

## License

MIT for the converter code. The manufacturer's PDF is **not** redistributed — only the publicly relevant datapoint information (IDs, types, ranges) is reproduced in this README for technical reference.
