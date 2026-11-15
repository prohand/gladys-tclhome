import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AC_FAN_SPEED,
  AC_MODE,
  buildFeatureSpecs,
  detectFamily,
  errorCodes,
  FAMILIES,
  supportedModes,
} from '../src/devices/catalog.js';
import { splitShadow } from './helpers/fakeTcl.js';

const SPLIT = detectFamily('Split AC');
const spec = (specs, key) => specs.find((item) => item.key === key);

test('recognizes the TCL families, numbered or not, and ignores the rest', () => {
  assert.equal(detectFamily('Split AC').family, FAMILIES.AIR_CONDITIONER);
  assert.equal(detectFamily('Split AC-2').family, FAMILIES.AIR_CONDITIONER);
  assert.equal(detectFamily('Portable AC').portable, true);
  assert.equal(detectFamily('Window AC').heat, false);
  assert.equal(detectFamily('Dehumidifier DEM').family, FAMILIES.DEHUMIDIFIER);
  assert.equal(detectFamily('breeva A3').family, FAMILIES.AIR_PURIFIER);
  assert.equal(detectFamily('Smart TV'), null);
  assert.equal(detectFamily(undefined), null);
});

test('numbers the work modes like TCL does, per family', () => {
  assert.deepEqual(supportedModes(SPLIT, {}), [
    AC_MODE.AUTO,
    AC_MODE.COOLING,
    AC_MODE.DRYING,
    AC_MODE.FAN,
    AC_MODE.HEATING,
  ]);
  assert.deepEqual(supportedModes(detectFamily('Window AC'), {}), [
    AC_MODE.AUTO,
    AC_MODE.COOLING,
    AC_MODE.DRYING,
    AC_MODE.FAN,
  ]);
  // A portable unit without the swing flap has no auto mode: cool is 0.
  const portable = detectFamily('Portable AC');
  assert.deepEqual(supportedModes(portable, {}), [AC_MODE.COOLING, AC_MODE.DRYING, AC_MODE.FAN]);
  assert.equal(supportedModes(portable, { swingWind: 0 })[0], AC_MODE.AUTO);
});

test('reads and writes the mode of a split unit', () => {
  const mode = spec(buildFeatureSpecs(SPLIT, splitShadow()), 'mode');
  assert.equal(mode.read({ workMode: 4 }), AC_MODE.HEATING);
  assert.equal(mode.read({ workMode: 1 }), AC_MODE.COOLING);
  assert.deepEqual(mode.write(AC_MODE.DRYING), { workMode: 2 });
  assert.deepEqual(
    mode.feature.supported_options.map((option) => option.value),
    [0, 1, 3, 4, 2],
  );
});

test('refuses a mode the unit does not have', () => {
  const mode = spec(buildFeatureSpecs(detectFamily('Window AC'), splitShadow()), 'mode');
  assert.throws(() => mode.write(AC_MODE.HEATING), /not supported/);
});

test('sends the target temperature, rounded, bounded, with its Fahrenheit copy', () => {
  const plain = spec(buildFeatureSpecs(SPLIT, splitShadow()), 'target-temperature');
  assert.deepEqual(plain.write(21.6), { targetTemperature: 22 });
  assert.deepEqual(plain.write(40), { targetTemperature: 31 });
  const withF = spec(
    buildFeatureSpecs(SPLIT, splitShadow({ targetFahrenheitTemp: 72 })),
    'target-temperature',
  );
  assert.deepEqual(withF.write(20), { targetTemperature: 20, targetFahrenheitTemp: 68 });
  // Portable units name it differently.
  const portable = spec(
    buildFeatureSpecs(detectFamily('Portable AC'), {
      powerSwitch: 1,
      targetCelsiusDegree: 24,
      targetFahrenheitDegree: 75,
    }),
    'target-temperature',
  );
  assert.equal(portable.read({ targetCelsiusDegree: 24 }), 24);
  assert.deepEqual(portable.write(18), { targetCelsiusDegree: 18, targetFahrenheitDegree: 64 });
});

test('maps the split fan speeds, quiet and turbo included', () => {
  const fan = spec(buildFeatureSpecs(SPLIT, splitShadow()), 'fan-speed');
  assert.equal(fan.read({ windSpeed: 0 }), AC_FAN_SPEED.AUTO);
  assert.equal(fan.read({ windSpeed: 2, silenceSwitch: 1 }), AC_FAN_SPEED.QUIET);
  assert.equal(fan.read({ windSpeed: 2 }), AC_FAN_SPEED.LOW);
  assert.equal(fan.read({ windSpeed: 4 }), AC_FAN_SPEED.MID);
  assert.equal(fan.read({ windSpeed: 6, turbo: 1 }), AC_FAN_SPEED.TURBO);
  assert.equal(fan.read({ windSpeed: 6, turbo: 0 }), AC_FAN_SPEED.HIGH);
  assert.deepEqual(fan.write(AC_FAN_SPEED.TURBO), { windSpeed: 6, turbo: 1, silenceSwitch: 0 });
  assert.deepEqual(fan.write(AC_FAN_SPEED.QUIET), { windSpeed: 2, turbo: 0, silenceSwitch: 1 });
  // Without the flags, neither the options nor the command mention them.
  const bare = spec(buildFeatureSpecs(SPLIT, { powerSwitch: 1, windSpeed: 0 }), 'fan-speed');
  assert.ok(!bare.feature.supported_options.some((o) => o.value === AC_FAN_SPEED.TURBO));
  assert.deepEqual(bare.write(AC_FAN_SPEED.HIGH), { windSpeed: 6 });
  assert.throws(() => bare.write(AC_FAN_SPEED.TURBO), /not supported/);
});

test('maps the flaps: swing, fixed positions, off', () => {
  const vertical = spec(buildFeatureSpecs(SPLIT, splitShadow()), 'swing-vertical');
  assert.equal(vertical.read({ verticalSwitch: 1, verticalDirection: 1 }), 1);
  assert.equal(vertical.read({ verticalSwitch: 0, verticalDirection: 9 }), 2);
  assert.equal(vertical.read({ verticalSwitch: 0, verticalDirection: 13 }), 6);
  assert.equal(vertical.read({ verticalSwitch: 0, verticalDirection: 8 }), 0);
  assert.deepEqual(vertical.write(1), { verticalDirection: 1, verticalSwitch: 1 });
  assert.deepEqual(vertical.write(4), { verticalDirection: 11, verticalSwitch: 0 });
  assert.deepEqual(vertical.write(0), { verticalDirection: 8, verticalSwitch: 0 });
});

test('publishes only the features the shadow shows', () => {
  const keys = (reported, kind = SPLIT) => buildFeatureSpecs(kind, reported).map((s) => s.key);
  assert.deepEqual(keys({ powerSwitch: 0 }), ['power']);
  assert.ok(keys(splitShadow()).includes('display'));
  assert.ok(!keys(splitShadow()).includes('outdoor-temperature'));
  assert.ok(keys(splitShadow({ externalUnitTemperature: 12 })).includes('outdoor-temperature'));
  assert.deepEqual(keys({ powerSwitch: 1, envHumidity: 55 }, detectFamily('Dehumidifier DF')), [
    'power',
    'humidity',
  ]);
  assert.deepEqual(keys({ powerSwitch: 1, PM25SensorValue: 8 }, detectFamily('breeva A2')), [
    'power',
    'pm25',
  ]);
});

test('every feature declares min and max (NOT NULL in Gladys)', () => {
  const all = [
    ...buildFeatureSpecs(SPLIT, splitShadow({ externalUnitTemperature: 3, swingWind: 0 })),
    ...buildFeatureSpecs(detectFamily('Portable AC'), {
      powerSwitch: 1,
      swingWind: 1,
      windSpeed: 0,
    }),
    ...buildFeatureSpecs(detectFamily('Dehumidifier DEM'), { envHumidity: 40 }),
    ...buildFeatureSpecs(detectFamily('breeva A5'), { PM25SensorValue: 4, screenSwitch: 1 }),
  ];
  for (const { key, feature } of all) {
    assert.equal(typeof feature.min, 'number', `${key}.min`);
    assert.equal(typeof feature.max, 'number', `${key}.max`);
    assert.ok(feature.name, `${key}.name`);
  }
});

test('reads the error codes, ignoring the empty ones', () => {
  assert.deepEqual(errorCodes({ errorCode: [] }), []);
  assert.deepEqual(errorCodes({ errorCode: [0, 'E1', 5] }), ['E1', '5']);
  assert.deepEqual(errorCodes({}), []);
});
