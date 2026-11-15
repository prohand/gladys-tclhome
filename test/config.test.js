import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, normalizeConfig } from '../src/config.js';

test('fills the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(hasCredentials(normalizeConfig()), false);
});

test('types and bounds the form values', () => {
  const config = normalizeConfig({
    username: ' me@example.com ',
    password: ' pw ',
    poll_frequency: '5',
  });
  assert.equal(config.username, 'me@example.com');
  assert.equal(config.password, ' pw ', 'a password is never trimmed');
  assert.equal(config.poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 60);
  assert.equal(hasCredentials(config), true);
});
