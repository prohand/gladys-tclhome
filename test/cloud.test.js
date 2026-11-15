import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TclAuthError,
  TclCloud,
  TclCloudError,
  expiryMs,
  jwtClaims,
  md5,
  normalizeThing,
} from '../src/tcl/cloud.js';
import { createFakeFetch, jwt, splitShadow, tclRoutes } from './helpers/fakeTcl.js';

const NOW = Date.parse('2026-11-15T10:00:00Z');

function cloudWith(routes, { now = () => NOW } = {}) {
  const { fetch, calls } = createFakeFetch(routes);
  const cloud = new TclCloud({ username: 'me@example.com', password: 'secret', fetch, now });
  return { cloud, calls };
}

test('logs in with the MD5 of the password, never the password itself', async () => {
  const { cloud, calls } = cloudWith(tclRoutes({ now: NOW }));
  await cloud.getThings();
  const login = calls.find((call) => call.url.startsWith('https://pa.account.tcl.com/'));
  const body = JSON.parse(login.init.body);
  assert.equal(body.username, 'me@example.com');
  assert.equal(body.password, md5('secret'));
  for (const call of calls) {
    assert.ok(!String(call.init.body ?? '').includes('"secret"'), `${call.url} leaks the password`);
  }
});

test('lists the devices of the account, under stable names', async () => {
  const { cloud } = cloudWith(
    tclRoutes({
      now: NOW,
      things: [
        { deviceId: 'ac1', nickName: 'Salon', deviceName: 'Split AC', isOnline: '1' },
        {
          device_id: 'ac2',
          device_name: 'Portable AC',
          is_online: 0,
          labels: [{ labelKey: 'room', labelValue: 'Bureau' }],
        },
        { deviceName: 'no id' },
      ],
    }),
  );
  const things = await cloud.getThings();
  assert.deepEqual(
    things.map(({ deviceId, name, deviceName, online }) => ({
      deviceId,
      name,
      deviceName,
      online,
    })),
    [
      { deviceId: 'ac1', name: 'Salon', deviceName: 'Split AC', online: true },
      { deviceId: 'ac2', name: 'Bureau', deviceName: 'Portable AC', online: false },
    ],
  );
  assert.equal(cloud.region, 'eu-central-1');
});

test('signs the TCL device list call with timestamp, nonce and MD5', async () => {
  const { cloud, calls } = cloudWith(tclRoutes({ now: NOW }));
  await cloud.getThings();
  const call = calls.find((item) => item.url.endsWith('/v3/user/get_things'));
  const { timestamp, nonce, sign, accesstoken } = call.init.headers;
  assert.equal(timestamp, String(NOW));
  assert.equal(sign, md5(timestamp + nonce + accesstoken));
});

test('a refused login is an authentication error', async () => {
  const { cloud } = cloudWith(
    tclRoutes({ now: NOW, login: () => ({ body: { status: 0, msg: 'wrong password' } }) }),
  );
  await assert.rejects(cloud.getThings(), TclAuthError);
});

test('a network failure is a cloud error that names the step', async () => {
  const cloud = new TclCloud({
    username: 'a',
    password: 'b',
    now: () => NOW,
    fetch: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    },
  });
  await assert.rejects(cloud.getThings(), (err) => {
    assert.ok(err instanceof TclCloudError);
    assert.match(err.message, /TCL login: network error \(ENOTFOUND\)/);
    return true;
  });
});

test('keeps the session until it expires, then logs in again', async () => {
  let now = NOW;
  const { cloud, calls } = cloudWith(tclRoutes({ now: NOW }), { now: () => now });
  await cloud.getThings();
  await cloud.getThings();
  const logins = () => calls.filter((call) => call.url.includes('pa.account.tcl.com')).length;
  assert.equal(logins(), 1);
  now += 2 * 60 * 60 * 1000; // the tokens of the fake expire after an hour
  await cloud.getThings();
  assert.equal(logins(), 2);
});

test('reads a shadow through the signed AWS IoT API', async () => {
  const { cloud, calls } = cloudWith(tclRoutes({ now: NOW }));
  const shadow = await cloud.getShadow('ac1');
  assert.deepEqual(shadow.reported, splitShadow());
  const call = calls.find((item) => item.url.endsWith('/shadow'));
  assert.equal(call.url, 'https://data-ats.iot.eu-central-1.amazonaws.com/things/ac1/shadow');
  assert.match(call.init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\//);
  assert.equal(call.init.headers['x-amz-security-token'], 'SESSION');
});

test('a device without shadow (a TV) reads as null', async () => {
  const routes = tclRoutes({ now: NOW });
  routes.unshift([(url) => url.endsWith('/shadow'), () => ({ status: 404, body: {} })]);
  const { cloud } = cloudWith(routes);
  assert.equal(await cloud.getShadow('tv'), null);
});

test('publishes a command on the shadow update topic, like the app', async () => {
  const { cloud, calls } = cloudWith(tclRoutes({ now: NOW }));
  await cloud.setDesired('ac1', { powerSwitch: 1 });
  const call = calls.find((item) => item.url.includes('/topics/'));
  assert.equal(
    call.url,
    'https://data-ats.iot.eu-central-1.amazonaws.com/topics/%24aws%2Fthings%2Fac1%2Fshadow%2Fupdate?qos=1',
  );
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), {
    state: { desired: { powerSwitch: 1 } },
    clientToken: `mobile_${Math.floor(NOW / 1000)}`,
  });
});

test('renews the AWS credentials once when AWS refuses them', async () => {
  let refusals = 1;
  const routes = tclRoutes({ now: NOW });
  routes.unshift([
    (url) => url.endsWith('/shadow') && refusals-- > 0,
    () => ({ status: 403, body: { message: 'expired' } }),
  ]);
  const { cloud, calls } = cloudWith(routes);
  const shadow = await cloud.getShadow('ac1');
  assert.ok(shadow);
  assert.equal(calls.filter((call) => call.url.includes('cognito-identity')).length, 2);
});

test('reads JWT claims and expiries in seconds or milliseconds', () => {
  assert.deepEqual(jwtClaims(jwt({ exp: 10, sub: 'x' })), { exp: 10, sub: 'x' });
  assert.deepEqual(jwtClaims('not a token'), {});
  assert.equal(expiryMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(expiryMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(expiryMs(undefined), 0);
});

test('names a device after its nickname, its room, then its model', () => {
  assert.equal(normalizeThing({ deviceId: 'a', nickName: 'Nick', room: 'R' }).name, 'Nick');
  assert.equal(normalizeThing({ deviceId: 'a', room: 'R', deviceName: 'Split AC' }).name, 'R');
  assert.equal(normalizeThing({ deviceId: 'a', deviceName: 'Split AC' }).name, 'Split AC');
});
