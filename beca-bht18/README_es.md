# Beca BHT-18GCLZB-FL — External converter para Zigbee2MQTT

[![Z2M version](https://img.shields.io/badge/Zigbee2MQTT-2.9%2B-blue)](https://www.zigbee2mqtt.io/)
[![HA version](https://img.shields.io/badge/HA-2024.6%2B-blue)](https://www.home-assistant.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/mainmind83/HA-varios/blob/main/LICENSE)

🇬🇧 **[English version — README.md](./README.md)**

External converter para [Zigbee2MQTT](https://www.zigbee2mqtt.io/) que amplía el soporte del termostato Beca BHT-18GCLZB-FL Zigbee (`_TZE204_ttnvdkiz` / `TS0601`) mucho más allá de los 4 datapoints básicos que exponen los converters iniciales disponibles en la comunidad.

## ¿Qué problema resuelve?

Hasta ahora este dispositivo no tenía soporte oficial en Z2M y los external converters disponibles exponían solo 4 datapoints: encendido, temperatura actual, consigna y estado del relé. Es suficiente para usarlo como sensor+interruptor "tonto", pero deja la mayor parte de la funcionalidad del termostato inalcanzable desde Home Assistant.

El 21 de abril de 2026 Becasmart compartió directamente la documentación oficial *MCU SDK Quick Start Guide* del producto Tuya `ttnvdkiz`, que enumera los 21 datapoints que expone el firmware. Este converter los mapea siguiendo esa especificación y preservando los mapeos validados empíricamente del converter original de la comunidad.

### Comparativa con otros converters

| Enfoque | Control básico | Calibración | Manual/programado | Histéresis | Modo ECO | Sensor suelo | Protecciones |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Converter genérico `TS0601` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Converter comunitario de 4 DPs | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Este converter** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Qué aporta

- **Calibración de temperatura** (DP 19) — ±9 °C, expuesta en el widget `climate` nativo.
- **Preset manual / programación semanal** (DP 109) — corrige el error común de apuntar a DP 2.
- **Blind spot / histéresis interna** (DP 111) — **clave cuando el termostato controla una bomba de calor modulante**: una zona muerta de 1–2 °C evita ciclos cortos del compresor.
- **Modo ECO** con consignas separadas de calor (DP 110) y frío (DP 108).
- **Selección de sensor** (DP 32): interno / suelo externo / ambos.
- **Límites de consigna** (DP 18 inferior, DP 34 superior) — topes físicos en el propio termostato.
- **Protecciones** anti-congelación y sobre-temperatura (DP 120, DP 121).
- **Bloqueo infantil** (DP 39) y modo de bloqueo half/full (DP 115).
- **Brillo** diurno (DP 117) y nocturno (DP 118) del display en standby.

## Instalación

### Paso 1 — Descargar el converter

Descarga [`bht18.js`](./bht18.js) a tu carpeta de configuración de Zigbee2MQTT, típicamente:

```
/config/zigbee2mqtt/bht18.js
```

### Paso 2 — Registrarlo como external converter

En el `configuration.yaml` de Zigbee2MQTT añade:

```yaml
external_converters:
  - bht18.js
```

### Paso 3 — Reiniciar Z2M y re-emparejar el dispositivo

Reinicia Zigbee2MQTT, y a continuación elimina el dispositivo en Z2M y vuelve a emparejarlo para que se creen las nuevas entidades.

### Verificación

Tras emparejar, el dispositivo debería exponer en Home Assistant:

- `climate.<n>` con temperatura, consigna y `local_temperature_calibration`.
- `switch.<n>` para encender/apagar el termostato.
- `binary_sensor.<n>_relay_state` — úsalo como fuente de demanda para tu sistema de calefacción.
- Un conjunto de entidades de configuración: `preset`, `eco_mode`, `deadzone_temperature`, `sensor_selection`, etc.

## Referencia de datapoints

### Verificados empíricamente

| DP | Función | Verificado | Estado |
| --- | --- | --- | --- |
| 1 | Encendido ON/OFF | abril 2026 | ✅ lectura y escritura |
| 2 | Modo de trabajo (`hot`/`cold`) | abril 2026 | ✅ lectura y escritura (confirmado 24/04 tras añadir el mapeo oficial) |
| 16 | Temperatura actual | abril 2026 | ✅ lectura |
| 47 | Estado del relé (`0`=ON, `1`=OFF) | abril 2026 | ✅ lectura |
| 50 | Consigna objetivo | abril 2026 | ✅ lectura y escritura |

> **Nota sobre DP 2:** las pruebas iniciales (15–17 de abril de 2026) declararon DP 2 "no funcional vía Zigbee". Esa conclusión era incorrecta: el test se hizo sin que DP 2 estuviera mapeado en el converter, así que Z2M ignoraba silenciosamente las escrituras y no podía decodificar las lecturas. Tras añadir el mapeo oficial (`enum: cold=0x00, hot=0x01`) según el PDF del fabricante, se confirmó lectura/escritura bidireccional el 24 de abril de 2026.

### Añadidos desde el PDF oficial del fabricante

| DP | Clave Z2M | Tipo | Notas |
| --- | --- | --- | --- |
| 18 | `min_temperature_limit` | numeric | Límite inferior sensor suelo, ÷10 |
| 19 | `local_temperature_calibration` | signed | ±9 °C, integrado en el widget `climate` |
| 32 | `sensor_selection` | enum | `in` / `out` / `inout` |
| 34 | `max_temperature_limit` | numeric | Tope superior de consigna, ÷10 |
| 39 | `child_lock` | binary | |
| 40 | `eco_mode` | binary | |
| 108 | `eco_cool_temp` | numeric | Rango 10–30, sin divisor |
| 109 | `preset` | enum | `schedule` / `manual` |
| 110 | `eco_heat_temp` | numeric | Rango 10–30, sin divisor |
| 111 | `deadzone_temperature` | numeric | **Blind spot, 1–5 °C** |
| 112 | `floor_temperature` | numeric | Reporta `0` si no hay NTC externo conectado |
| 114 | `display_setpoint_only` | binary | |
| 115 | `lock_mode` | enum | `half` / `full` |
| 117 | `brightness_day` | numeric | 0–8 |
| 118 | `brightness_night` | numeric | 0–8 |
| 120 | `frost_protection_temperature` | numeric | 0–10 °C |
| 121 | `high_protection_temperature` | numeric | 25–70 °C |

### Intencionalmente sin mapear

| DP | Función | Motivo |
| --- | --- | --- |
| 28 | Factory reset | Intencionalmente no expuesto por seguridad |
| 101–107 | Programación semanal (7 días, bloques raw de 128 bytes) | Formato complejo, requiere un converter dedicado tipo `ZWT198_schedule`. Podría añadirse en una versión futura. |

## Confirmar nuevos DPs en tu unidad

Las variaciones de firmware entre dispositivos Tuya OEM con el mismo PID son habituales. Si algún DP no responde como se espera, activa [el logging debug de Z2M](https://www.zigbee2mqtt.io/guide/configuration/logging.html) y observa líneas como:

```
Datapoint 'X' with value 'Y' not defined for '_TZE204_ttnvdkiz'
```

Si encuentras una corrección de mapeo o quieres confirmar el comportamiento de un DP concreto, por favor abre una issue — hay una plantilla de confirmación de DP disponible en [`dp_confirmation_template.md`](./dp_confirmation_template.md).

## Documentación del fabricante

Este converter se basa en el *MCU SDK Quick Start Guide* oficial del producto Tuya `ttnvdkiz`, compartido de forma privada por el fabricante (Beca / Xiamen Beca Energysaving Technology Co., Ltd) el 21 de abril de 2026.

El PDF no se republica en este repositorio porque no se ha concedido permiso explícito de redistribución pública. Si necesitas acceso al documento para tu propio trabajo de integración, contacta directamente con Becasmart — han sido receptivos a peticiones técnicas. La tabla de datapoints de este README reproduce los IDs, tipos y rangos tal como están documentados, que es la información necesaria para entender y extender el converter.

## Contexto upstream

- Issue original de soporte en Z2M: [Koenkk/zigbee2mqtt#31736](https://github.com/Koenkk/zigbee2mqtt/issues/31736)
- Guía oficial de Z2M para dispositivos Tuya: [Support new Tuya devices](https://www.zigbee2mqtt.io/advanced/support-new-devices/02_support_new_tuya_devices.html)
- zigbee-herdsman-converters: [src/lib/tuya.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/lib/tuya.ts) — referencia de las implementaciones de `valueConverter`

Una vez validados empíricamente todos los DPs nuevos, la intención es abrir un PR contra `zigbee-herdsman-converters` para integrar este soporte en la distribución oficial de Z2M.

## Licencia

MIT para el código del converter. El PDF del fabricante **no** se redistribuye — solo se reproduce en este README la información de datapoints (IDs, tipos, rangos) que es relevante como referencia técnica.
