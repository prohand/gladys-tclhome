import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TclHome } from '../src/devices/index.js';
import { normalizeConfig } from '../src/config.js';
import { TclAuthError } from '../src/tcl/cloud.js';
import { WIDGET_ACTIONS, buildOverview, handleOverviewAction } from '../src/widgets.js';
import { FakeCloud, splitShadow, thing } from './helpers/fakeTcl.js';
import { LANGUAGES } from '../src/i18n.js';

async function setup(cloud = new FakeCloud()) {
  const gladys = createFakeGladys();
  const home = new TclHome({ gladys, createCloud: () => cloud, confirmDelayMs: 0 });
  home.configure(normalizeConfig({ username: 'a', password: 'b' }));
  await home.refreshAll();
  return { gladys, home, cloud };
}

test('the content is rendered exactly as sent, in every state', async () => {
  const empty = new TclHome({ gladys: createFakeGladys() });
  assert.deepEqual(validateWidgetContent(buildOverview(empty)), [], 'not configured');

  const { home } = await setup(
    new FakeCloud({
      things: [
        thing(),
        thing({ deviceId: 'ac2', name: 'Bedroom', online: false }),
        thing({ deviceId: 'ac3', name: 'Office' }),
        thing({ deviceId: 'ac4', name: 'A very long name for a portable unit in the attic' }),
      ],
      shadows: {
        ac1: splitShadow(),
        ac2: splitShadow(),
        ac3: splitShadow({ powerSwitch: 0 }),
        ac4: splitShadow({ workMode: 4 }),
      },
    }),
  );
  const content = buildOverview(home);
  assert.deepEqual(validateWidgetContent(content), [], 'four units');
  assert.ok(content.components.length <= 8);

  home.lastError = new TclAuthError('refused');
  assert.deepEqual(validateWidgetContent(buildOverview(home)), [], 'refused login');
  home.lastError = new Error('AWS IoT: HTTP 503');
  assert.deepEqual(validateWidgetContent(buildOverview(home)), [], 'cloud down');
});

test('the status rows say what each unit does', async () => {
  const { home } = await setup();
  const status = buildOverview(home).components.find((c) => c.type === 'status');
  assert.equal(status.items[1].value.en, 'Cool · 22 °C');
  assert.equal(status.items[1].value.fr, 'Froid · 22 °C');
});

test('live tiles reference features the integration publishes', async () => {
  const { home } = await setup();
  const published = new Set(
    home.buildDiscoveredDevices().flatMap((device) => device.features.map((f) => f.external_id)),
  );
  const tiles = buildOverview(home).components.filter((c) => c.device_feature);
  assert.ok(tiles.length > 0);
  for (const tile of tiles) assert.ok(published.has(tile.device_feature), tile.device_feature);
});

test('every button is handled and answers a short toast in every language', async () => {
  const { home, cloud } = await setup();
  const buttons = buildOverview(home).components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((button) => button.action.key).sort(),
    Object.values(WIDGET_ACTIONS).sort(),
  );
  let refreshed = 0;
  for (const { action } of buttons) {
    const values = Object.fromEntries(
      (action.fields ?? []).filter((f) => f.default !== undefined).map((f) => [f.key, f.default]),
    );
    const toast = await handleOverviewAction(home, {
      actionKey: action.key,
      values,
      refresh: async () => {
        refreshed += 1;
      },
    });
    for (const language of LANGUAGES) {
      assert.ok(toast[language]?.length > 0 && toast[language].length <= 200, language);
    }
  }
  assert.equal(refreshed, 1);
  // The form defaults ("unchanged") only turn the unit on.
  assert.deepEqual(cloud.commands[0].desired, { powerSwitch: 1 });
});

test('an unknown widget action fails, so the user sees the error', async () => {
  const { home } = await setup();
  await assert.rejects(
    handleOverviewAction(home, { actionKey: 'nope', refresh: async () => {} }),
    /Unknown widget action/,
  );
});
