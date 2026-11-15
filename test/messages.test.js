import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_REFUSED,
  MISSING_CREDENTIALS,
  describeAccount,
  describeFailure,
} from '../src/messages.js';
import { TclAuthError, TclCloudError } from '../src/tcl/cloud.js';
import { LANGUAGES, localize, pick } from '../src/i18n.js';

const everyLanguage = (text) => {
  for (const language of LANGUAGES) assert.ok(text[language]?.length > 0, language);
};

test('every message exists in English, French, German and Spanish', () => {
  everyLanguage(MISSING_CREDENTIALS);
  everyLanguage(AUTH_REFUSED);
  everyLanguage(describeFailure(new TclCloudError('TCL login: HTTP 500')));
});

test('a refused login reads as such', () => {
  assert.equal(describeFailure(new TclAuthError('x')), AUTH_REFUSED);
  assert.match(describeFailure(new Error('AWS IoT: HTTP 503')).fr, /HTTP 503/);
});

test('the account report names the devices and the unsupported ones', () => {
  const home = {
    list: () => [
      { thing: { name: 'Salon', online: true } },
      { thing: { name: 'Bureau', online: false } },
    ],
    unsupported: [{ name: 'TV' }],
  };
  const text = describeAccount(home);
  everyLanguage(text);
  assert.equal(text.en, 'Connected: 2 device(s), 1 online (Salon, Bureau). Not supported: TV.');
  assert.match(describeAccount({ list: () => [], unsupported: [] }).fr, /^Connecté, mais/);
});

test('pick falls back to English', () => {
  assert.equal(pick('it', { en: 'a', fr: 'b' }), 'a');
  assert.deepEqual(Object.keys(localize(() => 'x')), LANGUAGES);
});
