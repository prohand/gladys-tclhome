import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AVAILABILITY, SCENE_TRIGGERS, TclHome } from '../src/devices/index.js';
import { AC_MODE } from '../src/devices/catalog.js';
import { normalizeConfig } from '../src/config.js';
import { TclAuthError } from '../src/tcl/cloud.js';
import { FakeCloud, splitShadow, thing } from './helpers/fakeTcl.js';

const CONFIG = normalizeConfig({ username: 'me@example.com', password: 'pw', poll_frequency: 60 });

function setup({ cloud = new FakeCloud(), now = () => 0 } = {}) {
  const gladys = createFakeGladys();
  const home = new TclHome({ gladys, createCloud: () => cloud, now, confirmDelayMs: 0 });
  home.configure(CONFIG);
  // What index.js registers.
  gladys.onSetValue((device, feature, value) => home.setValue(device, feature, value));
  return { gladys, home, cloud };
}

/** The created device as Gladys hands it back (onPoll, onSetValue). */
async function created(gladys, home) {
  await home.refreshAll();
  await gladys.publishDiscoveredDevices(home.buildDiscoveredDevices());
  return gladys.fake.discoveredDevices[0];
}

test('discovers one Gladys device per supported TCL device, accepted by Gladys', async () => {
  const cloud = new FakeCloud({
    things: [thing(), thing({ deviceId: 'tv', name: 'TV', deviceName: 'Smart TV' })],
  });
  const { gladys, home } = setup({ cloud });
  const device = await created(gladys, home);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(device.name, 'Living room');
  assert.equal(device.poll_frequency, 60_000);
  assert.ok(device.features.some((f) => f.category === 'air-conditioning' && f.type === 'mode'));
  assert.deepEqual(
    home.unsupported.map((item) => item.name),
    ['TV'],
  );
});

test('without credentials there is no cloud, and nothing is polled', async () => {
  const gladys = createFakeGladys();
  const home = new TclHome({ gladys, createCloud: () => new FakeCloud() });
  assert.equal(home.cloud, null);
  assert.equal(await home.poll({ external_id: 'x' }), false);
  await assert.rejects(home.refreshAll(), /not configured/);
});

test('a poll publishes the states of the device', async () => {
  const { gladys, home } = setup();
  const device = await created(gladys, home);
  assert.equal(await home.poll(device), true);
  const ids = home.ids('ac1');
  assert.equal(gladys.fake.lastState(ids.feature('power')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('mode')), AC_MODE.COOLING);
  assert.equal(gladys.fake.lastState(ids.feature('target-temperature')), 22);
  assert.equal(gladys.fake.lastState(ids.feature('indoor-temperature')), 25);
});

test('polls at the configured interval, not at every Gladys tick', async () => {
  let now = 0;
  const { gladys, home } = setup({ now: () => now });
  home.configure({ ...CONFIG, poll_frequency: 300 });
  const device = await created(gladys, home);
  assert.equal(await home.poll(device), true);
  now += 60_000;
  assert.equal(await home.poll(device), false);
  now += 240_000;
  assert.equal(await home.poll(device), true);
});

test('a command goes to the shadow and its state to Gladys', async () => {
  const { gladys, home, cloud } = setup();
  const device = await created(gladys, home);
  const feature = device.features.find((f) => f.external_id.endsWith(':mode'));
  await gladys.fake.setValue(device, feature, AC_MODE.HEATING);
  assert.deepEqual(cloud.commands, [{ deviceId: 'ac1', desired: { workMode: 4 } }]);
  assert.equal(gladys.fake.lastState(feature.external_id), AC_MODE.HEATING);
});

test('a command to an offline device fails, so Gladys shows it', async () => {
  const cloud = new FakeCloud({ things: [thing({ online: false })] });
  const { gladys, home } = setup({ cloud });
  const device = await created(gladys, home);
  const feature = device.features.find((f) => f.external_id.endsWith(':power'));
  const ack = await gladys.fake.setValue(device, feature, 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /offline/);
  assert.deepEqual(cloud.commands, []);
});

test('fires availability_changed when a device goes offline, not at startup', async () => {
  const { gladys, home, cloud } = setup();
  await home.refreshThings();
  assert.deepEqual(gladys.fake.sceneEvents, []);
  cloud.things = [thing({ online: false })];
  await home.refreshThings();
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.AVAILABILITY_CHANGED,
      data: { device: home.ids('ac1').device, status: AVAILABILITY.OFFLINE },
    },
  ]);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
});

test('fires error_reported once per new error code', async () => {
  const { gladys, home, cloud } = setup();
  await home.refreshAll();
  cloud.shadows.ac1 = splitShadow({ errorCode: ['E5'] });
  await home.readShadow(home.list()[0]);
  await home.readShadow(home.list()[0]);
  assert.deepEqual(gladys.fake.sceneEvents, [
    { key: SCENE_TRIGGERS.ERROR_REPORTED, data: { device: home.ids('ac1').device, code: 'E5' } },
  ]);
});

test('sets a whole climate in one command', async () => {
  const { home, cloud } = setup();
  await home.refreshAll();
  const applied = await home.applyClimate(home.ids('ac1').device, {
    mode: AC_MODE.COOLING,
    temperature: 23,
    fanSpeed: 0,
  });
  assert.equal(applied, true);
  assert.deepEqual(cloud.commands[0].desired, {
    powerSwitch: 1,
    workMode: 1,
    targetTemperature: 23,
    windSpeed: 0,
    turbo: 0,
    silenceSwitch: 0,
  });
  assert.equal(await home.applyClimate('ext:unknown', {}), false);
});

test('turns off every device that is on, and starts a self-clean', async () => {
  const cloud = new FakeCloud({
    things: [thing(), thing({ deviceId: 'ac2', name: 'Bedroom' })],
    shadows: { ac1: splitShadow(), ac2: splitShadow({ powerSwitch: 0 }) },
  });
  const { home } = setup({ cloud });
  await home.refreshAll();
  assert.equal(await home.turnOffAll(), 1);
  assert.deepEqual(cloud.commands, [{ deviceId: 'ac1', desired: { powerSwitch: 0 } }]);
  assert.equal(await home.selfClean(home.ids('ac2').device), true);
  assert.deepEqual(cloud.commands[1].desired, { powerSwitch: 0, selfClean: 1 });
});

test('new credentials start a new session', () => {
  const clouds = [];
  const home = new TclHome({
    gladys: createFakeGladys(),
    createCloud: () => clouds.push(new FakeCloud()) && clouds.at(-1),
  });
  home.configure(CONFIG);
  home.configure({ ...CONFIG, poll_frequency: 120 });
  assert.equal(clouds.length, 1);
  home.configure({ ...CONFIG, password: 'other' });
  assert.equal(clouds.length, 2);
});

test('a refused password stops the polls until the configuration changes', async () => {
  const { gladys, home, cloud } = setup();
  const device = await created(gladys, home);
  home.lastError = new TclAuthError('refused');
  let calls = 0;
  cloud.getThings = async () => {
    calls += 1;
    return [];
  };
  assert.equal(await home.poll(device), false);
  assert.equal(calls, 0);
  home.configure({ ...CONFIG, password: 'fixed' });
  assert.equal(home.lastError, null);
});
