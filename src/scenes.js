// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+).
//
// Each action is declared in the manifest `scene_actions` field and handled
// here under the same key; index.js registers them with `onSceneAction`.
//
//   set_climate   turn an air conditioner on, with a mode, a target
//                 temperature and a fan speed, in one command
//   turn_off_all  turn off every TCL device that is on
//   self_clean    start the self-cleaning cycle of an air conditioner
//
// The `fields` arrive resolved and validated by the core; a `"source":
// "devices"` field is the chosen device external_id. A device that is offline
// is an output (`applied: false`), not a failure: a scene action is never a
// condition, the scene author gates on the output.
//
// The scene TRIGGERS (availability_changed, error_reported) are fired by
// src/devices/index.js when it reads the devices.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AC_FAN_SPEED, AC_MODE } from './devices/catalog.js';

const logger = createLogger({ name: 'scenes' });

/** Scene action keys, as declared in the manifest. Never renamed: scenes store them. */
export const SCENE_ACTION_KEYS = {
  SET_CLIMATE: 'set_climate',
  TURN_OFF_ALL: 'turn_off_all',
  SELF_CLEAN: 'self_clean',
};

/** `mode` option values of set_climate -> Gladys AC_MODE. `keep`: unchanged. */
export const MODE_OPTIONS = {
  auto: AC_MODE.AUTO,
  cool: AC_MODE.COOLING,
  heat: AC_MODE.HEATING,
  dry: AC_MODE.DRYING,
  fan: AC_MODE.FAN,
};

/** `fan_speed` option values of set_climate -> Gladys AC_FAN_SPEED. */
export const FAN_SPEED_OPTIONS = {
  auto: AC_FAN_SPEED.AUTO,
  quiet: AC_FAN_SPEED.QUIET,
  low: AC_FAN_SPEED.LOW,
  medium: AC_FAN_SPEED.MID,
  high: AC_FAN_SPEED.HIGH,
  turbo: AC_FAN_SPEED.TURBO,
};

/** The set_climate fields as TclHome.applyClimate reads them. */
export function climateRequest(fields = {}) {
  const temperature = Number(fields.target_temperature);
  return {
    mode: MODE_OPTIONS[fields.mode],
    temperature:
      fields.target_temperature === undefined ||
      fields.target_temperature === null ||
      fields.target_temperature === '' ||
      !Number.isFinite(temperature)
        ? undefined
        : temperature,
    fanSpeed: FAN_SPEED_OPTIONS[fields.fan_speed],
  };
}

/**
 * The handlers, keyed by scene action. Each one receives the TclHome instance
 * and the resolved fields, and resolves the declared outputs.
 */
export const SCENE_ACTIONS = {
  async [SCENE_ACTION_KEYS.SET_CLIMATE](home, fields) {
    logger.info(`Scene action set_climate <- ${fields.device}`);
    const applied = await home.applyClimate(fields.device, climateRequest(fields));
    return { applied };
  },

  async [SCENE_ACTION_KEYS.TURN_OFF_ALL](home) {
    logger.info('Scene action turn_off_all');
    const count = await home.turnOffAll();
    return { count };
  },

  async [SCENE_ACTION_KEYS.SELF_CLEAN](home, fields) {
    logger.info(`Scene action self_clean <- ${fields.device}`);
    const started = await home.selfClean(fields.device);
    return { started };
  },
};
