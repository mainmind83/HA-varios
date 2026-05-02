const tuya = require('zigbee-herdsman-converters/lib/tuya');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const e = exposes.presets;
const ea = exposes.access;

// =============================================================================
// Beca BHT-18GCLZB-FL Zigbee (TS0601 / _TZE204_ttnvdkiz)
// =============================================================================
//
// Converter ampliado a partir del protocolo oficial del fabricante:
//   - Tuya MCU SDK Quick Start Guide, producto ttnvdkiz (Bht18_Zigbee)
//   - Documento recibido de Becasmart el 21/04/2026
//
// -----------------------------------------------------------------------------
// MAPA DE DATAPOINTS
// -----------------------------------------------------------------------------
//
// VERIFICADOS EMPÍRICAMENTE:
//   DP1   bool   On/Off general                     → climate.system_mode
//   DP2   enum   Modo: 0=cold, 1=hot                → climate.system_mode
//   DP16  value  Temperatura actual (÷10)           → local_temperature ✓
//   DP47  enum   Relé interno: 0=ON, 1=OFF          → relay_state ✓
//   DP50  value  Consigna objetivo (÷10)            → current_heating_setpoint ✓
//
// AÑADIDOS DEL PDF DEL FABRICANTE (pendientes de validación empírica):
//   DP18  value  Límite inferior sensor suelo (÷10)
//   DP19  value  Calibración temp. ambiente (±9 °C)
//   DP32  enum   Selección sensor (0=in, 1=out, 2=inout)
//   DP34  value  Tope máximo de consigna (÷10)
//   DP39  bool   Bloqueo infantil
//   DP40  bool   Modo ECO
//   DP108 value  ECO cool temp (rango 10-30)
//   DP109 bool   Régimen: 0=schedule, 1=manual
//   DP110 value  ECO heat temp (rango 10-30)
//   DP111 value  Blind spot / histéresis (1-5 °C)
//   DP112 value  Temperatura sensor suelo NTC (÷10)
//   DP114 bool   Mostrar solo consigna
//   DP115 enum   Tipo bloqueo (0=half, 1=full)
//   DP117 value  Brillo standby diurno (0-8)
//   DP118 value  Brillo standby nocturno (0-8)
//   DP120 value  Protección anti-congelación (0-10)
//   DP121 value  Protección sobre-temperatura (25-70)
//
// EXCLUIDOS A PROPÓSITO:
//   DP28      Factory reset (peligroso)
//   DP101-107 Programación semanal raw 128 bytes (formato complejo)
//
// -----------------------------------------------------------------------------
// ARQUITECTURA: system_mode unificado (02/05/2026)
// -----------------------------------------------------------------------------
//
// climate.system_mode (off/heat/cool) es la ÚNICA vía de control on/off + modo:
//
//   ESCRITURA (handler tzLocal.system_mode):
//     'off'  → DP1=false (DP2 sin cambios)
//     'heat' → DP2=hot (1) + DP1=true
//     'cool' → DP2=cold (0) + DP1=true
//
//   LECTURA (converters fromDP1 / fromDP2 con clave null):
//     DP1=false           → system_mode='off'
//     DP1=true + DP2=cold → system_mode='cool'
//     DP1=true + DP2=hot  → system_mode='heat'
//
// Esta arquitectura unificada evita el conflicto de tener dos atributos
// HA (state + working_mode) escribiendo a DPs distintos por separado, lo
// que provocaba desincronización de system_mode al pulsar físicamente o
// al escribir directamente desde Z2M.
//
// =============================================================================

// Handler de escritura para system_mode: coordina DP1 + DP2 según el valor
const tzLocal = {
    system_mode: {
        key: ['system_mode'],
        convertSet: async (entity, key, value, meta) => {
            if (value === 'off') {
                await tuya.sendDataPointBool(entity, 1, false);
                return { state: { system_mode: 'off' } };
            }
            const modeValue = (value === 'heat') ? 1 : 0;
            await tuya.sendDataPointEnum(entity, 2, modeValue);
            await tuya.sendDataPointBool(entity, 1, true);
            return { state: { system_mode: value } };
        },
    },
};

// fromZigbee custom para DP1: deriva system_mode (off / heat o cool según DP2)
const fromDP1 = {
    from: (value, meta) => {
        const isOn = (value === 1 || value === true);
        if (!isOn) return { system_mode: 'off' };
        // Encendido: usar working_mode interno (último DP2 conocido)
        const lastDP2 = meta?.state?._dp2;
        return { system_mode: (lastDP2 === 0) ? 'cool' : 'heat' };
    },
};

// fromZigbee custom para DP2: deriva system_mode si está encendido,
// y guarda el último valor de DP2 en meta.state._dp2 para que fromDP1 lo use.
const fromDP2 = {
    from: (value, meta) => {
        const result = { _dp2: value }; // memorizar valor crudo de DP2
        const stateOn = meta?.state?.system_mode && meta.state.system_mode !== 'off';
        if (stateOn) {
            result.system_mode = (value === 1) ? 'heat' : 'cool';
        }
        return result;
    },
};

const definition = {
    fingerprint: tuya.fingerprint('TS0601', ['_TZE204_ttnvdkiz']),
    model: 'BHT-18GCLZB-FL',
    vendor: 'Beca',
    description: 'Thermostat suelo radiante Zigbee (Boiler + refrigeración, 230V)',
    fromZigbee: [tuya.fz.datapoints],
    toZigbee: [tzLocal.system_mode, tuya.tz.datapoints],
    onEvent: tuya.onEventSetTime,
    configure: tuya.configureMagicPacket,

    exposes: [
        // --- Climate principal ---------------------------------------------
        // system_mode: única vía de control on/off + heat/cool (DP1 + DP2)
        e.climate()
            .withSetpoint('current_heating_setpoint', 5, 45, 0.5, ea.STATE_SET)
            .withLocalTemperature(ea.STATE)
            .withLocalTemperatureCalibration(-9, 9, 1, ea.STATE_SET)
            .withSystemMode(['off', 'heat', 'cool'], ea.STATE_SET),

        // --- Diagnóstico ----------------------------------------------------
        // relay_state (DP47) NO es lo mismo que el state on/off (DP1):
        // indica si el relé interno está cerrando contacto físicamente,
        // útil para detectar demanda real al boiler/aerotermia.
        exposes.binary('relay_state', ea.STATE, 'ON', 'OFF')
            .withDescription('Estado del relé interno (DP47). ON = el termostato '
                + 'está cerrando contacto y solicitando demanda al sistema.'),

        // --- Configuración de régimen ---------------------------------------
        exposes.enum('preset', ea.STATE_SET, ['manual', 'schedule'])
            .withDescription('Modo manual o programación semanal'),
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
            .withDescription('Temperatura sensor NTC suelo (0 si no hay sensor conectado)'),

        // --- Límites y protecciones -----------------------------------------
        exposes.numeric('max_temperature_limit', ea.STATE_SET)
            .withUnit('°C').withValueMin(15).withValueMax(45).withValueStep(0.5)
            .withDescription('Tope máximo de consigna configurable en el termostato'),
        exposes.numeric('min_temperature_limit', ea.STATE_SET)
            .withUnit('°C').withValueMin(5).withValueMax(35).withValueStep(0.5)
            .withDescription('Límite inferior sensor suelo'),
        exposes.numeric('frost_protection_temperature', ea.STATE_SET)
            .withUnit('°C').withValueMin(0).withValueMax(10).withValueStep(1)
            .withDescription('Protección anti-congelación'),
        exposes.numeric('high_protection_temperature', ea.STATE_SET)
            .withUnit('°C').withValueMin(25).withValueMax(70).withValueStep(1)
            .withDescription('Protección sobre-temperatura suelo'),

        // --- Histéresis interna (clave para suelo radiante) -----------------
        exposes.numeric('deadzone_temperature', ea.STATE_SET)
            .withUnit('°C').withValueMin(1).withValueMax(5).withValueStep(1)
            .withDescription('Histéresis interna del termostato. Con aerotermia '
                + 'modulante conviene 1-2 °C para evitar ciclos cortos'),

        // --- Seguridad / display --------------------------------------------
        e.child_lock(),
        exposes.enum('lock_mode', ea.STATE_SET, ['half', 'full'])
            .withDescription('Tipo de bloqueo: parcial (solo consigna) o total'),
        exposes.binary('display_setpoint_only', ea.STATE_SET, 'ON', 'OFF')
            .withDescription('Mostrar solo la consigna (no la temperatura actual)'),
        exposes.numeric('brightness_day', ea.STATE_SET)
            .withValueMin(0).withValueMax(8).withValueStep(1)
            .withDescription('Brillo standby diurno (0-8)'),
        exposes.numeric('brightness_night', ea.STATE_SET)
            .withValueMin(0).withValueMax(8).withValueStep(1)
            .withDescription('Brillo standby nocturno (0-8)'),
    ],

    meta: {
        tuyaDatapoints: [
            // --- DP1 + DP2: derivan system_mode --------------------------
            [1,   null,                            fromDP1],
            [2,   null,                            fromDP2],

            // --- Climate -------------------------------------------------
            [16,  'local_temperature',             tuya.valueConverter.divideBy10],
            [50,  'current_heating_setpoint',      tuya.valueConverter.divideBy10],
            [19,  'local_temperature_calibration', tuya.valueConverter.localTempCalibration3],

            // --- Diagnóstico ---------------------------------------------
            [47,  'relay_state',                   tuya.valueConverterBasic.lookup({'ON': tuya.enum(0), 'OFF': tuya.enum(1)})],

            // --- Configuración régimen -----------------------------------
            [109, 'preset',                        tuya.valueConverterBasic.lookup({'schedule': tuya.enum(0), 'manual': tuya.enum(1)})],
            [40,  'eco_mode',                      tuya.valueConverter.onOff],
            [108, 'eco_cool_temp',                 tuya.valueConverter.raw],
            [110, 'eco_heat_temp',                 tuya.valueConverter.raw],

            // --- Sensor de suelo -----------------------------------------
            [32,  'sensor_selection',              tuya.valueConverterBasic.lookup({'in': tuya.enum(0), 'out': tuya.enum(1), 'inout': tuya.enum(2)})],
            [112, 'floor_temperature',             tuya.valueConverter.divideBy10],

            // --- Límites -------------------------------------------------
            [18,  'min_temperature_limit',         tuya.valueConverter.divideBy10],
            [34,  'max_temperature_limit',         tuya.valueConverter.divideBy10],

            // --- Protecciones --------------------------------------------
            [120, 'frost_protection_temperature',  tuya.valueConverter.raw],
            [121, 'high_protection_temperature',   tuya.valueConverter.raw],

            // --- Histéresis interna --------------------------------------
            [111, 'deadzone_temperature',          tuya.valueConverter.raw],

            // --- Seguridad / display -------------------------------------
            [39,  'child_lock',                    tuya.valueConverter.onOff],
            [115, 'lock_mode',                     tuya.valueConverterBasic.lookup({'half': tuya.enum(0), 'full': tuya.enum(1)})],
            [114, 'display_setpoint_only',         tuya.valueConverter.onOff],
            [117, 'brightness_day',                tuya.valueConverter.raw],
            [118, 'brightness_night',              tuya.valueConverter.raw],
        ],
    },
};

module.exports = definition;
