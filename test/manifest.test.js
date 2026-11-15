// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there knows which
// handlers the code registers: these tests keep both sides in sync, and catch
// the store rules that are easiest to miss before a release does.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, POLL_FREQUENCY_MAX, POLL_FREQUENCY_MIN } from '../src/config.js';
import { AVAILABILITY, SCENE_TRIGGERS } from '../src/devices/index.js';
import { TARGET_MAX, TARGET_MIN } from '../src/devices/catalog.js';
import { FAN_SPEED_OPTIONS, MODE_OPTIONS, SCENE_ACTIONS } from '../src/scenes.js';
import { OVERVIEW_WIDGET } from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

const allFields = [
  ...manifest.config_schema,
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

/** Whether the minimum of `gladys_version` is at least major.minor. */
function floorAtLeast(wantedMajor, wantedMinor) {
  const match = manifest.gladys_version.match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
  assert.ok(match, 'gladys_version must be a ">=x.y.z" range');
  const [major, minor] = match.slice(1).map(Number);
  return major > wantedMajor || (major === wantedMajor && minor >= wantedMinor);
}

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means a hand edit.
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-tclhome:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/prohand\/gladys-tclhome\/main\/cover\.png$/,
  );
});

test('the integration declares the cloud transport and the cloud keyword', () => {
  // TCL appliances are only reachable through the TCL Home cloud: there is no
  // local channel, so no "Prefer the local connection" toggle either.
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.keywords.includes('cloud'));
  assert.ok(!manifest.keywords.includes('local'));
});

test('the Gladys floor covers every field the manifest declares', () => {
  // categories: 4.86, widgets and scenes: 5.1, widget button forms: 5.2,
  // keywords: 5.3.
  assert.ok(floorAtLeast(5, 3), `keywords need 5.3.0, got ${manifest.gladys_version}`);
});

const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the categories and keywords follow the store rules', () => {
  const { categories, keywords } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3);
  for (const category of categories) assert.ok(CATEGORIES.includes(category), category);
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
});

test('name and description fit what the store allows, in every language', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const language of LANGUAGES) {
    const { length } = manifest.description[language];
    assert.ok(length >= 10 && length <= 100, `description.${language}: ${length} characters`);
  }
  for (const widget of manifest.widgets) {
    for (const language of LANGUAGES) {
      assert.ok(widget.label[language].length >= 3 && widget.label[language].length <= 30);
      assert.ok(widget.description[language].length <= 100);
    }
  }
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') return [];
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every text of the manifest carries en, fr, de and es', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 40, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

test('every field uses a type the store accepts, with its own options', () => {
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type ${field.type}`);
    assert.match(field.key, /^[a-z0-9_]+$/);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
      assert.ok(['string', 'number', 'secret'].includes(field.type));
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `field "${field.key}": source and options`);
    }
  }
});

test('config_schema defaults and keys stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.equal(field.required, undefined);
      assert.equal(field.default, undefined);
      assert.ok(!(field.key in DEFAULT_CONFIG));
      for (const link of field.links ?? []) assert.match(link.url, /^https:\/\//);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" unknown to the code`);
    if (field.default !== undefined) assert.equal(DEFAULT_CONFIG[field.key], field.default);
  }
  const poll = manifest.config_schema.find((field) => field.key === 'poll_frequency');
  assert.equal(poll.min, POLL_FREQUENCY_MIN);
  assert.equal(poll.max, POLL_FREQUENCY_MAX);
  assert.equal(
    manifest.config_schema.find((field) => field.key === 'password').type,
    'secret',
    'the password is a secret field',
  );
});

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions) {
    assert.match(indexSource, new RegExp(`onAction\\('${action.key}'`), action.key);
  }
});

test('the scene actions of the manifest are the handlers, with the same options', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.match(indexSource, /onSceneAction\(key/);
  const climate = manifest.scene_actions.find((action) => action.key === 'set_climate');
  const field = (key) => climate.fields.find((item) => item.key === key);
  assert.deepEqual(
    field('mode')
      .options.map((option) => option.value)
      .sort(),
    Object.keys(MODE_OPTIONS).sort(),
  );
  assert.deepEqual(
    field('fan_speed')
      .options.map((option) => option.value)
      .sort(),
    Object.keys(FAN_SPEED_OPTIONS).sort(),
  );
  assert.equal(field('target_temperature').min, TARGET_MIN);
  assert.equal(field('target_temperature').max, TARGET_MAX);
  for (const action of manifest.scene_actions) {
    for (const output of action.outputs ?? []) {
      assert.ok(['boolean', 'number', 'string'].includes(output.type), output.key);
    }
  }
});

test('the scene triggers the code fires are the ones the manifest declares', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  const availability = manifest.scene_triggers.find(
    (trigger) => trigger.key === SCENE_TRIGGERS.AVAILABILITY_CHANGED,
  );
  assert.deepEqual(
    availability.fields
      .find((field) => field.key === 'status')
      .options.map((o) => o.value)
      .sort(),
    Object.values(AVAILABILITY).sort(),
  );
});

test('the widget of the manifest is the one index.js serves', () => {
  assert.deepEqual(keysOf(manifest.widgets), [OVERVIEW_WIDGET]);
  assert.match(indexSource, /onWidgetGet\(OVERVIEW_WIDGET/);
  assert.match(indexSource, /onWidgetAction\(OVERVIEW_WIDGET/);
});

test('the documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    await access(new URL(`../docs/${language}.md`, import.meta.url));
  }
});
