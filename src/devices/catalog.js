// -----------------------------------------------------------------------------
// From a TCL device to Gladys features, and back.
//
// A TCL device is described by two things:
//   - its entry in the account device list (`get_things`): id, name, online,
//     and `deviceName`, the product family ("Split AC", "Portable AC-2"…);
//   - its AWS IoT shadow, whose `reported` object holds one property per
//     function: `powerSwitch`, `workMode`, `targetTemperature`, `windSpeed`…
//
// The family says how a value is coded (the work modes are numbered in a
// different order on a portable unit); the shadow says what THIS unit has: a
// feature is only published when its property is in the shadow, so a model
// without vertical swing never shows a swing control that does nothing.
//
// Every feature below is a small object:
//   key       stable suffix of the feature external_id (never renamed)
//   feature   the Gladys feature (category, type, min, max, unit…)
//   read      shadow `reported` -> Gladys value (null when unknown)
//   write     Gladys value -> `desired` properties to send
//
// The values follow the Gladys core constants (server/utils/constants.js):
// AC_MODE, AC_FAN_SPEED, AC_SWING_VERTICAL / AC_SWING_HORIZONTAL.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';

/** Gladys AC_MODE. */
export const AC_MODE = { AUTO: 0, COOLING: 1, HEATING: 2, DRYING: 3, FAN: 4 };

/** Gladys AC_FAN_SPEED. */
export const AC_FAN_SPEED = {
  AUTO: 0,
  LOW: 1,
  LOW_MID: 2,
  MID: 3,
  MID_HIGH: 4,
  HIGH: 5,
  QUIET: 6,
  TURBO: 7,
};

/** Gladys AC_SWING_VERTICAL / AC_SWING_HORIZONTAL (POSITION_1 = 2 … POSITION_5 = 6). */
export const AC_SWING = { OFF: 0, SWING: 1, POSITION_1: 2 };

/** Target temperature range of TCL air conditioners, in °C. */
export const TARGET_MIN = 16;
export const TARGET_MAX = 31;

/** Device families. */
export const FAMILIES = {
  AIR_CONDITIONER: 'air-conditioner',
  DEHUMIDIFIER: 'dehumidifier',
  AIR_PURIFIER: 'air-purifier',
};

// The work modes in the order TCL numbers them: a unit numbers the modes it
// has, in this order, from 0 (a portable unit without auto mode: cool = 0).
const TCL_MODE_ORDER = [
  AC_MODE.AUTO,
  AC_MODE.COOLING,
  AC_MODE.DRYING,
  AC_MODE.FAN,
  AC_MODE.HEATING,
];

/** Labels of the modes, for the supported options and the widget. */
export const MODE_LABELS = {
  [AC_MODE.AUTO]: { en: 'Auto', fr: 'Auto', de: 'Automatik', es: 'Automático' },
  [AC_MODE.COOLING]: { en: 'Cool', fr: 'Froid', de: 'Kühlen', es: 'Frío' },
  [AC_MODE.HEATING]: { en: 'Heat', fr: 'Chaud', de: 'Heizen', es: 'Calor' },
  [AC_MODE.DRYING]: { en: 'Dry', fr: 'Déshumidification', de: 'Entfeuchten', es: 'Deshumidificar' },
  [AC_MODE.FAN]: { en: 'Fan', fr: 'Ventilation', de: 'Lüften', es: 'Ventilador' },
};

export const FAN_SPEED_LABELS = {
  [AC_FAN_SPEED.AUTO]: { en: 'Auto', fr: 'Auto', de: 'Automatik', es: 'Automático' },
  [AC_FAN_SPEED.QUIET]: { en: 'Quiet', fr: 'Silencieux', de: 'Leise', es: 'Silencioso' },
  [AC_FAN_SPEED.LOW]: { en: 'Low', fr: 'Faible', de: 'Niedrig', es: 'Baja' },
  [AC_FAN_SPEED.LOW_MID]: {
    en: 'Medium-low',
    fr: 'Moyen-faible',
    de: 'Mittel-niedrig',
    es: 'Media-baja',
  },
  [AC_FAN_SPEED.MID]: { en: 'Medium', fr: 'Moyen', de: 'Mittel', es: 'Media' },
  [AC_FAN_SPEED.MID_HIGH]: {
    en: 'Medium-high',
    fr: 'Moyen-fort',
    de: 'Mittel-hoch',
    es: 'Media-alta',
  },
  [AC_FAN_SPEED.HIGH]: { en: 'High', fr: 'Fort', de: 'Hoch', es: 'Alta' },
  [AC_FAN_SPEED.TURBO]: { en: 'Turbo', fr: 'Turbo', de: 'Turbo', es: 'Turbo' },
};

/**
 * The family of a device, from the `deviceName` of the device list.
 * Several units of one family carry a numbered name ("Split AC-2").
 * @returns {{ family: string, portable?: boolean, heat?: boolean } | null}
 *   null for a TCL device this integration does not drive (a TV…)
 */
export function detectFamily(deviceName) {
  const name = String(deviceName ?? '')
    .trim()
    .toLowerCase()
    .replace(/-\d+$/, '');
  switch (name) {
    case 'split ac':
    case 'split ac fresh air':
    case 'cylindrical ac':
    case 'duct':
      return { family: FAMILIES.AIR_CONDITIONER, heat: true };
    case 'window ac':
      return { family: FAMILIES.AIR_CONDITIONER, heat: false };
    case 'portable ac':
      return { family: FAMILIES.AIR_CONDITIONER, heat: false, portable: true };
    case 'dehumidifier dem':
    case 'dehumidifier df':
      return { family: FAMILIES.DEHUMIDIFIER };
    case 'breeva a2':
    case 'breeva a3':
    case 'breeva a5':
      return { family: FAMILIES.AIR_PURIFIER };
    default:
      return null;
  }
}

const has = (reported, property) =>
  reported !== null && typeof reported === 'object' && reported[property] !== undefined;

/** A number from the shadow, or null when absent or not a number. */
function numberOf(reported, property) {
  if (!has(reported, property)) return null;
  const value = Number(reported[property]);
  return Number.isFinite(value) ? value : null;
}

/** The Gladys modes of a unit, in the TCL numbering order. */
export function supportedModes(kind, reported) {
  return TCL_MODE_ORDER.filter((mode) => {
    if (mode === AC_MODE.HEATING) return kind.heat === true;
    // A portable unit only has an auto mode when it has the swing flap that
    // comes with it (what the app shows, see the Home Assistant integration).
    if (mode === AC_MODE.AUTO && kind.portable) return has(reported, 'swingWind');
    return true;
  });
}

const options = (values, labels) =>
  values.map((value, index) => ({ value, label: labels[value].en, sort_order: index }));

function binarySwitch(key, name, property) {
  return {
    key,
    feature: {
      name,
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    read: (reported) => {
      const value = numberOf(reported, property);
      return value === null ? null : value > 0 ? 1 : 0;
    },
    write: (value) => ({ [property]: value > 0 ? 1 : 0 }),
  };
}

function powerFeature(kind) {
  const ac = kind.family === FAMILIES.AIR_CONDITIONER;
  return {
    key: 'power',
    feature: {
      name: 'Power',
      category: ac ? CATEGORIES.AIR_CONDITIONING : CATEGORIES.SWITCH,
      type: ac ? TYPES.AIR_CONDITIONING.BINARY : TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    read: (reported) => {
      const value = numberOf(reported, 'powerSwitch');
      return value === null ? null : value > 0 ? 1 : 0;
    },
    write: (value) => ({ powerSwitch: value > 0 ? 1 : 0 }),
  };
}

function modeFeature(kind, reported) {
  const modes = supportedModes(kind, reported);
  return {
    key: 'mode',
    feature: {
      name: 'Mode',
      category: CATEGORIES.AIR_CONDITIONING,
      type: TYPES.AIR_CONDITIONING.MODE,
      min: 0,
      max: 4,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      supported_options: options(modes, MODE_LABELS),
    },
    read: (state) => {
      const index = numberOf(state, 'workMode');
      return index === null || modes[index] === undefined ? null : modes[index];
    },
    write: (value) => {
      const index = modes.indexOf(Number(value));
      if (index === -1) throw new Error(`Mode ${value} is not supported by this unit`);
      return { workMode: index };
    },
  };
}

function targetTemperatureFeature(reported) {
  // Split units say `targetTemperature`, portable ones `targetCelsiusDegree`.
  const property = has(reported, 'targetTemperature') ? 'targetTemperature' : 'targetCelsiusDegree';
  // Some units keep a Fahrenheit copy that must follow, or the display shows
  // the old target (the app always sends both).
  const fahrenheit = ['targetFahrenheitTemp', 'targetFahrenheitDegree'].find((name) =>
    has(reported, name),
  );
  return {
    key: 'target-temperature',
    feature: {
      name: 'Target temperature',
      category: CATEGORIES.AIR_CONDITIONING,
      type: TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE,
      unit: UNITS.CELSIUS,
      min: TARGET_MIN,
      max: TARGET_MAX,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    read: (state) => numberOf(state, property),
    write: (value) => {
      const celsius = Math.min(TARGET_MAX, Math.max(TARGET_MIN, Math.round(Number(value))));
      if (!Number.isFinite(celsius)) throw new Error(`Invalid temperature: ${value}`);
      const desired = { [property]: celsius };
      if (fahrenheit) desired[fahrenheit] = Math.round((celsius * 9) / 5 + 32);
      return desired;
    },
  };
}

// Split units code the fan speed on `windSpeed` (0 auto, 2…6 low to high),
// with two flags on top: `silenceSwitch` (quiet, on speed 2) and `turbo` (on
// speed 6).
const SPLIT_FAN_DESIRED = {
  [AC_FAN_SPEED.AUTO]: { windSpeed: 0, turbo: 0, silenceSwitch: 0 },
  [AC_FAN_SPEED.QUIET]: { windSpeed: 2, turbo: 0, silenceSwitch: 1 },
  [AC_FAN_SPEED.LOW]: { windSpeed: 2, turbo: 0, silenceSwitch: 0 },
  [AC_FAN_SPEED.LOW_MID]: { windSpeed: 3, turbo: 0, silenceSwitch: 0 },
  [AC_FAN_SPEED.MID]: { windSpeed: 4, turbo: 0, silenceSwitch: 0 },
  [AC_FAN_SPEED.MID_HIGH]: { windSpeed: 5, turbo: 0, silenceSwitch: 0 },
  [AC_FAN_SPEED.HIGH]: { windSpeed: 6, turbo: 0, silenceSwitch: 0 },
  [AC_FAN_SPEED.TURBO]: { windSpeed: 6, turbo: 1, silenceSwitch: 0 },
};

function splitFanSpeedFeature(reported) {
  const quiet = has(reported, 'silenceSwitch');
  const turbo = has(reported, 'turbo');
  const speeds = [
    AC_FAN_SPEED.AUTO,
    ...(quiet ? [AC_FAN_SPEED.QUIET] : []),
    AC_FAN_SPEED.LOW,
    AC_FAN_SPEED.LOW_MID,
    AC_FAN_SPEED.MID,
    AC_FAN_SPEED.MID_HIGH,
    AC_FAN_SPEED.HIGH,
    ...(turbo ? [AC_FAN_SPEED.TURBO] : []),
  ];
  return {
    key: 'fan-speed',
    feature: {
      name: 'Fan speed',
      category: CATEGORIES.AIR_CONDITIONING,
      type: TYPES.AIR_CONDITIONING.FAN_SPEED,
      min: 0,
      max: 7,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: options(speeds, FAN_SPEED_LABELS),
    },
    read: (state) => {
      const speed = numberOf(state, 'windSpeed');
      if (speed === null) return null;
      if (speed === 6)
        return numberOf(state, 'turbo') === 1 ? AC_FAN_SPEED.TURBO : AC_FAN_SPEED.HIGH;
      if (speed === 5) return AC_FAN_SPEED.MID_HIGH;
      if (speed === 4) return AC_FAN_SPEED.MID;
      if (speed === 3) return AC_FAN_SPEED.LOW_MID;
      if (speed === 2 || speed === 1) {
        return numberOf(state, 'silenceSwitch') === 1 ? AC_FAN_SPEED.QUIET : AC_FAN_SPEED.LOW;
      }
      return AC_FAN_SPEED.AUTO;
    },
    write: (value) => {
      const desired = SPLIT_FAN_DESIRED[Number(value)];
      if (!desired || !speeds.includes(Number(value))) {
        throw new Error(`Fan speed ${value} is not supported by this unit`);
      }
      // Only send the flags the unit has.
      const sent = { windSpeed: desired.windSpeed };
      if (turbo) sent.turbo = desired.turbo;
      if (quiet) sent.silenceSwitch = desired.silenceSwitch;
      return sent;
    },
  };
}

// Portable units with an auto mode code `windSpeed` 0 auto, 1 low, 2 high.
const PORTABLE_FAN = [AC_FAN_SPEED.AUTO, AC_FAN_SPEED.LOW, AC_FAN_SPEED.HIGH];

function portableFanSpeedFeature() {
  return {
    key: 'fan-speed',
    feature: {
      name: 'Fan speed',
      category: CATEGORIES.AIR_CONDITIONING,
      type: TYPES.AIR_CONDITIONING.FAN_SPEED,
      min: 0,
      max: 7,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: options(PORTABLE_FAN, FAN_SPEED_LABELS),
    },
    read: (state) => {
      const speed = numberOf(state, 'windSpeed');
      return speed === null || PORTABLE_FAN[speed] === undefined ? null : PORTABLE_FAN[speed];
    },
    write: (value) => {
      const index = PORTABLE_FAN.indexOf(Number(value));
      if (index === -1) throw new Error(`Fan speed ${value} is not supported by this unit`);
      return { windSpeed: index };
    },
  };
}

// Flap direction: 1 swing, 2-3 partial swings, 8 not set, 9…13 fixed
// positions (top to bottom, or left to right). The switch property (when the
// unit has one) must follow, or the unit keeps swinging.
function swingFeature(axis, reported) {
  const vertical = axis === 'vertical';
  const direction = vertical ? 'verticalDirection' : 'horizontalDirection';
  const toggle = vertical ? 'verticalSwitch' : 'horizontalSwitch';
  const hasToggle = has(reported, toggle);
  const values = [AC_SWING.OFF, AC_SWING.SWING, 2, 3, 4, 5, 6];
  const labels = [
    'Off',
    'Swing',
    'Position 1',
    'Position 2',
    'Position 3',
    'Position 4',
    'Position 5',
  ];
  return {
    key: vertical ? 'swing-vertical' : 'swing-horizontal',
    feature: {
      name: vertical ? 'Vertical swing' : 'Horizontal swing',
      category: CATEGORIES.AIR_CONDITIONING,
      type: vertical
        ? TYPES.AIR_CONDITIONING.SWING_VERTICAL
        : TYPES.AIR_CONDITIONING.SWING_HORIZONTAL,
      min: 0,
      max: vertical ? 6 : 7,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: values.map((value, index) => ({
        value,
        label: labels[index],
        sort_order: index,
      })),
    },
    read: (state) => {
      const value = numberOf(state, direction);
      if (value === null) return null;
      if (value >= 9 && value <= 13) return value - 7; // 9 -> POSITION_1 (2)
      if (value >= 1 && value <= 4 && numberOf(state, toggle) !== 0) return AC_SWING.SWING;
      return AC_SWING.OFF;
    },
    write: (value) => {
      const gladys = Number(value);
      let desired;
      if (gladys === AC_SWING.SWING)
        desired = { [direction]: 1, ...(hasToggle && { [toggle]: 1 }) };
      else if (gladys >= 2 && gladys <= 6) {
        desired = { [direction]: gladys + 7, ...(hasToggle && { [toggle]: 0 }) };
      } else if (gladys === AC_SWING.OFF) {
        desired = { [direction]: 8, ...(hasToggle && { [toggle]: 0 }) };
      } else throw new Error(`Swing position ${value} is not supported`);
      return desired;
    },
  };
}

function sensor(key, name, property, { category, type, unit, min, max }) {
  return {
    key,
    feature: {
      name,
      category,
      type,
      unit,
      min,
      max,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
    read: (state) => numberOf(state, property),
  };
}

/**
 * The features of one device, as far as its shadow shows them.
 * @param {{ family: string }} kind from detectFamily
 * @param {object} reported the `reported` part of its shadow
 */
export function buildFeatureSpecs(kind, reported = {}) {
  const specs = [powerFeature(kind)];
  if (kind.family === FAMILIES.AIR_CONDITIONER) {
    if (has(reported, 'workMode')) specs.push(modeFeature(kind, reported));
    if (has(reported, 'targetTemperature') || has(reported, 'targetCelsiusDegree')) {
      specs.push(targetTemperatureFeature(reported));
    }
    if (has(reported, 'windSpeed')) {
      if (!kind.portable) specs.push(splitFanSpeedFeature(reported));
      else if (has(reported, 'swingWind')) specs.push(portableFanSpeedFeature());
    }
    if (has(reported, 'verticalDirection')) specs.push(swingFeature('vertical', reported));
    if (has(reported, 'horizontalDirection')) specs.push(swingFeature('horizontal', reported));
    if (has(reported, 'currentTemperature')) {
      specs.push(
        sensor('indoor-temperature', 'Indoor temperature', 'currentTemperature', {
          category: CATEGORIES.TEMPERATURE_SENSOR,
          type: TYPES.SENSOR.DECIMAL,
          unit: UNITS.CELSIUS,
          min: -20,
          max: 60,
        }),
      );
    }
    if (has(reported, 'externalUnitTemperature')) {
      specs.push(
        sensor('outdoor-temperature', 'Outdoor unit temperature', 'externalUnitTemperature', {
          category: CATEGORIES.TEMPERATURE_SENSOR,
          type: TYPES.TEMPERATURE_SENSOR.PROBE,
          unit: UNITS.CELSIUS,
          min: -40,
          max: 70,
        }),
      );
    }
    const switches = [
      ['eco', 'Eco', 'ECO'],
      ['sleep', 'Sleep', 'sleep'],
      ['health', 'Health (ionizer)', 'healthy'],
      ['anti-mold', 'Anti-mold drying', 'antiMoldew'],
      ['display', 'Display', 'screen'],
      ['beep', 'Beep', 'beepSwitch'],
      ['swing', 'Swing', 'swingWind'],
    ];
    for (const [key, name, property] of switches) {
      if (has(reported, property)) specs.push(binarySwitch(key, name, property));
    }
  } else if (kind.family === FAMILIES.DEHUMIDIFIER) {
    if (has(reported, 'envHumidity')) {
      specs.push(
        sensor('humidity', 'Humidity', 'envHumidity', {
          category: CATEGORIES.HUMIDITY_SENSOR,
          type: TYPES.SENSOR.DECIMAL,
          unit: UNITS.PERCENT,
          min: 0,
          max: 100,
        }),
      );
    }
  } else if (kind.family === FAMILIES.AIR_PURIFIER) {
    if (has(reported, 'PM25SensorValue')) {
      specs.push(
        sensor('pm25', 'PM2.5', 'PM25SensorValue', {
          category: CATEGORIES.PM25_SENSOR,
          type: TYPES.SENSOR.DECIMAL,
          unit: UNITS.MICROGRAM_PER_CUBIC_METER,
          min: 0,
          max: 1000,
        }),
      );
    }
    for (const [key, name, property] of [
      ['display', 'Display', 'screenSwitch'],
      ['child-lock', 'Child lock', 'childLockSwitch'],
    ]) {
      if (has(reported, property)) specs.push(binarySwitch(key, name, property));
    }
  }
  return specs;
}

/** The error codes a device reports (an empty list when all is well). */
export function errorCodes(reported) {
  const codes = reported?.errorCode;
  if (!Array.isArray(codes)) return [];
  return codes.map((code) => String(code)).filter((code) => code !== '' && code !== '0');
}
