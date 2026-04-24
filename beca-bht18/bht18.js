const tuya = require('zigbee-herdsman-converters/lib/tuya');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const e = exposes.presets;
const ea = exposes.access;

// =============================================================================
// Beca BHT-18GCLZB-FL Zigbee (TS0601 / _TZE204_ttnvdkiz)
// =============================================================================
// Converter ampliado a partir del protocolo oficial del fabricante:
//   - Tuya MCU SDK Quick Start Guide, producto ttnvdkiz (Bht18_Zigbee)
//   - Documento recibido de Becasmart el 21/04/2026
//
// DPs VERIFICADOS EMPÍRICAMENTE (15-17/04/2026):
//   DP1  → estado ON/OFF general  ✓
//   DP16 → temperatura actual (÷10) ✓
//   DP47 → estado del relé interno (0=ON, 1=OFF) ✓
//   DP50 → consigna objetivo (÷10) ✓
//
// DPs AÑADIDOS A PARTIR DEL PDF DEL FABRICANTE (pendientes de confirmar en logs):
//   DP2   → modo calor/frío (cold/hot) — documentado por fabricante como enum
//           RW. Previamente considerado "no funcional vía Zigbee" tras pruebas
//           15-17/04, pero se añade para re-validar con el mapeo oficial ahora
//           disponible. Si en tu firmware no responde, abre issue.
//   DP18  → límite inferior sensor suelo
//   DP19  → calibración temperatura ambiente (±9 °C)
//   DP32  → selección sensor (in / out / inout)
//   DP34  → límite superior de la consigna
//   DP39  → bloqueo infantil
//   DP40  → modo ECO
//   DP109 → programación / manual
//   DP111 → blind spot (histéresis interna)  ← CLAVE PARA CALOR RADIANTE
//   DP112 → temperatura de suelo (solo con NTC externo)
//   DP114 → pantalla solo consigna
//   DP115 → medio bloqueo / bloqueo total
//   DP117 → brillo standby diurno (0-8)
//   DP118 → brillo standby nocturno (0-8)
//   DP120 → protección baja (anti-congelación)
//   DP121 → protección alta
//
// DPs DESCARTADOS INTENCIONALMENTE:
//   DP28  → factory reset: peligroso, no se expone
//   DP101-107 → programación semanal (raw 128 bytes): formato complejo,
//               requiere converter propio tipo thermostatScheduleDayMultiDP
//               → se deja fuera de esta versión
//
// NOTAS IMPORTANTES:
//   - DPs con rango ×10 (temperaturas de setpoint/ambiente): 16, 18, 34, 50, 112
//     → usan `tuya.valueConverter.divideBy10`
//   - DPs con rango ×1 (calibración, eco temps, blindspot, brillos, protecciones):
//     19, 108, 110, 111, 117, 118, 120, 121
//     → usan `tuya.valueConverter.raw` (valor directo)
//   - DP19 lleva `localTempCalibration3` porque la librería Tuya maneja el
//     complemento a 2 automáticamente para valores negativos.
//
// =============================================================================

const definition = {
    fingerprint: tuya.fingerprint('TS0601', ['_TZE204_ttnvdkiz']),
    model: 'BHT-18GCLZB-FL',
    vendor: 'Beca',
    description: 'Thermostat suelo radiante Zigbee (Boiler + refrigeración, 230V)',
    fromZigbee: [tuya.fz.datapoints],
    toZigbee: [tuya.tz.datapoints],
    onEvent: tuya.onEventSetTime,
    configure: tuya.configureMagicPacket,

    exposes: [
        // --- Bloque climate principal ---------------------------------------
        e.climate()
            .withSetpoint('current_heating_setpoint', 5, 45, 0.5, ea.STATE_SET)
            .withLocalTemperature(ea.STATE)
            .withLocalTemperatureCalibration(-9, 9, 1, ea.STATE_SET),

        // --- Encendido / estado relé / estado general -----------------------
        e.switch(),
        exposes.binary('relay_state', ea.STATE, 'ON', 'OFF')
            .withDescription('Estado del relé interno (ON=activo, OFF=inactivo) — usado como fuente de demanda en HA'),
        exposes.enum('working_mode', ea.STATE_SET, ['hot', 'cold'])
            .withDescription('Modo de trabajo calor/frío (DP2). Documentado por fabricante como RW, '
                + 'pendiente de re-validar empíricamente. Si no responde en tu firmware, '
                + 'abre issue en el repo.'),

        // --- Configuración de régimen ---------------------------------------
        exposes.enum('preset', ea.STATE_SET, ['manual', 'schedule'])
            .withDescription('Modo manual o programación semanal (DP109 según fabricante)'),
        exposes.binary('eco_mode', ea.STATE_SET, 'ON', 'OFF')
            .withDescription('Modo ECO (consigna reducida según eco_heat_temp / eco_cool_temp)'),
        exposes.numeric('eco_heat_temp', ea.STATE_SET)
            .withUnit('°C').withValueMin(10).withValueMax(30).withValueStep(1)
            .withDescription('Consigna en modo ECO calor'),
        exposes.numeric('eco_cool_temp', ea.STATE_SET)
            .withUnit('°C').withValueMin(10).withValueMax(30).withValueStep(1)
            .withDescription('Consigna en modo ECO frío'),

        // --- Sensor de suelo (opcional, solo con NTC conectado) -------------
        exposes.enum('sensor_selection', ea.STATE_SET, ['in', 'out', 'inout'])
            .withDescription('Sensor activo: interno (in), externo de suelo (out) o ambos (inout)'),
        exposes.numeric('floor_temperature', ea.STATE)
            .withUnit('°C')
            .withDescription('Temperatura sensor NTC suelo (solo si está conectado; 0 si no lo está)'),

        // --- Límites y protecciones -----------------------------------------
        exposes.numeric('max_temperature_limit', ea.STATE_SET)
            .withUnit('°C').withValueMin(15).withValueMax(45).withValueStep(0.5)
            .withDescription('Tope máximo de consigna configurable en el termostato (DP34)'),
        exposes.numeric('min_temperature_limit', ea.STATE_SET)
            .withUnit('°C').withValueMin(5).withValueMax(35).withValueStep(0.5)
            .withDescription('Límite inferior sensor suelo (DP18)'),
        exposes.numeric('frost_protection_temperature', ea.STATE_SET)
            .withUnit('°C').withValueMin(0).withValueMax(10).withValueStep(1)
            .withDescription('Protección anti-congelación (DP120)'),
        exposes.numeric('high_protection_temperature', ea.STATE_SET)
            .withUnit('°C').withValueMin(25).withValueMax(70).withValueStep(1)
            .withDescription('Protección sobre-temperatura suelo (DP121)'),

        // --- Histéresis interna (clave para suelo radiante) -----------------
        exposes.numeric('deadzone_temperature', ea.STATE_SET)
            .withUnit('°C').withValueMin(1).withValueMax(5).withValueStep(1)
            .withDescription('Blind spot / histéresis interna del termostato (DP111). '
                + 'Con aerotermia modulante conviene 1-2 °C para evitar ciclos cortos'),

        // --- Seguridad / display --------------------------------------------
        e.child_lock(),
        exposes.enum('lock_mode', ea.STATE_SET, ['half', 'full'])
            .withDescription('Tipo de bloqueo: parcial (solo consigna) o total (DP115)'),
        exposes.binary('display_setpoint_only', ea.STATE_SET, 'ON', 'OFF')
            .withDescription('Mostrar solo la consigna (no la temperatura actual)'),
        exposes.numeric('brightness_day', ea.STATE_SET)
            .withValueMin(0).withValueMax(8).withValueStep(1)
            .withDescription('Brillo standby diurno (0-8, DP117)'),
        exposes.numeric('brightness_night', ea.STATE_SET)
            .withValueMin(0).withValueMax(8).withValueStep(1)
            .withDescription('Brillo standby nocturno (0-8, DP118)'),
    ],

    meta: {
        tuyaDatapoints: [
            // --- Verificados empíricamente 15-17/04/2026 --------------------
            [1,   'state',                         tuya.valueConverter.onOff],
            [16,  'local_temperature',             tuya.valueConverter.divideBy10],
            [47,  'relay_state',                   tuya.valueConverterBasic.lookup({'ON': tuya.enum(0), 'OFF': tuya.enum(1)})],
            [50,  'current_heating_setpoint',      tuya.valueConverter.divideBy10],

            // --- Configuración régimen (pendiente confirmar en logs) --------
            // DP2: modo calor/frío. Fabricante: enum (cold=0x00, hot=0x01).
            // Previamente declarado "no funcional" 15-17/04 ANTES de tener el
            // mapeo oficial. Re-mapear ahora con codificación del PDF para
            // revalidar. Si tras reinstalar el converter no responde a cambios
            // (lectura o escritura), abrir issue con logs de Z2M.
            [2,   'working_mode',                  tuya.valueConverterBasic.lookup({'cold': tuya.enum(0), 'hot': tuya.enum(1)})],
            // DP109: según fabricante es bool (0=schedule, 1=manual). Algunos
            // firmwares lo invierten — revisar al añadir.
            [109, 'preset',                        tuya.valueConverterBasic.lookup({'schedule': tuya.enum(0), 'manual': tuya.enum(1)})],
            [40,  'eco_mode',                      tuya.valueConverter.onOff],
            [108, 'eco_cool_temp',                 tuya.valueConverter.raw],
            [110, 'eco_heat_temp',                 tuya.valueConverter.raw],

            // --- Sensor de suelo --------------------------------------------
            [32,  'sensor_selection',              tuya.valueConverterBasic.lookup({'in': tuya.enum(0), 'out': tuya.enum(1), 'inout': tuya.enum(2)})],
            [112, 'floor_temperature',             tuya.valueConverter.divideBy10],

            // --- Calibración y límites --------------------------------------
            [19,  'local_temperature_calibration', tuya.valueConverter.localTempCalibration3],
            [18,  'min_temperature_limit',         tuya.valueConverter.divideBy10],
            [34,  'max_temperature_limit',         tuya.valueConverter.divideBy10],

            // --- Protecciones -----------------------------------------------
            [120, 'frost_protection_temperature',  tuya.valueConverter.raw],
            [121, 'high_protection_temperature',   tuya.valueConverter.raw],

            // --- Histéresis interna -----------------------------------------
            [111, 'deadzone_temperature',          tuya.valueConverter.raw],

            // --- Seguridad / display ----------------------------------------
            [39,  'child_lock',                    tuya.valueConverter.onOff],
            [115, 'lock_mode',                     tuya.valueConverterBasic.lookup({'half': tuya.enum(0), 'full': tuya.enum(1)})],
            [114, 'display_setpoint_only',         tuya.valueConverter.onOff],
            [117, 'brightness_day',                tuya.valueConverter.raw],
            [118, 'brightness_night',              tuya.valueConverter.raw],
        ],
    },
};

module.exports = definition;
