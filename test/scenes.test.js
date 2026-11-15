import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TclHome } from '../src/devices/index.js';
import { AC_FAN_SPEED, AC_MODE } from '../src/devices/catalog.js';
import { normalizeConfig } from '../src/config.js';
import { SCENE_ACTIONS, SCENE_ACTION_KEYS, climateRequest } from '../src/scenes.js';
import { FakeCloud, thing } from './helpers/fakeTcl.js';

async function setup(cloud = new FakeCloud()) {
  const gladys = createFakeGladys();
  const home = new TclHome({ gladys, createCloud: () => cloud, confirmDelayMs: 0 });
  home.configure(normalizeConfig({ username: 'a', password: 'b' }));
  await home.refreshAll();
  return { home, cloud };
}

test('reads the set_climate fields; empty means unchanged', () => {
  assert.deepEqual(climateRequest({ mode: 'heat', target_temperature: '21', fan_speed: 'turbo' }), {
    mode: AC_MODE.HEATING,
    temperature: 21,
    fanSpeed: AC_FAN_SPEED.TURBO,
  });
  assert.deepEqual(climateRequest({ target_temperature: '' }), {
    mode: undefined,
    temperature: undefined,
    fanSpeed: undefined,
  });
});

test('set_climate answers its declared output', async () => {
  const { home, cloud } = await setup();
  const outputs = await SCENE_ACTIONS[SCENE_ACTION_KEYS.SET_CLIMATE](home, {
    device: home.ids('ac1').device,
    mode: 'cool',
    target_temperature: 24,
  });
  assert.deepEqual(outputs, { applied: true });
  assert.deepEqual(cloud.commands[0].desired, {
    powerSwitch: 1,
    workMode: 1,
    targetTemperature: 24,
  });
});

test('an offline unit is an output, not a failure', async () => {
  const { home } = await setup(new FakeCloud({ things: [thing({ online: false })] }));
  const outputs = await SCENE_ACTIONS.set_climate(home, { device: home.ids('ac1').device });
  assert.deepEqual(outputs, { applied: false });
  assert.deepEqual(await SCENE_ACTIONS.self_clean(home, { device: home.ids('ac1').device }), {
    started: false,
  });
});

test('turn_off_all counts the devices it turned off', async () => {
  const { home } = await setup();
  assert.deepEqual(await SCENE_ACTIONS.turn_off_all(home, {}), { count: 1 });
  assert.deepEqual(await SCENE_ACTIONS.turn_off_all(home, {}), { count: 0 });
});
