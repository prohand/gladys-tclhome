// -----------------------------------------------------------------------------
// Test doubles for the TCL side: no test touches the network.
//
//   - jwt(claims)            an unsigned JWT carrying the claims (the code only
//                            reads them);
//   - createFakeFetch(...)   the TCL and AWS HTTP endpoints, answered in memory;
//   - FakeCloud              the TclCloud interface, for the device tests.
// -----------------------------------------------------------------------------

export function jwt(claims) {
  const part = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.signature`;
}

/** A split air conditioner shadow, as TCL reports it. */
export function splitShadow(overrides = {}) {
  return {
    powerSwitch: 1,
    workMode: 1, // cool
    targetTemperature: 22,
    currentTemperature: 25,
    windSpeed: 0,
    turbo: 0,
    silenceSwitch: 0,
    verticalSwitch: 0,
    verticalDirection: 8,
    horizontalSwitch: 0,
    horizontalDirection: 8,
    ECO: 0,
    sleep: 0,
    screen: 1,
    beepSwitch: 1,
    healthy: 0,
    antiMoldew: 0,
    selfClean: 0,
    errorCode: [],
    ...overrides,
  };
}

export function thing(overrides = {}) {
  return {
    deviceId: 'ac1',
    name: 'Living room',
    deviceName: 'Split AC',
    category: 'AC',
    productKey: 'pk',
    firmwareVersion: '1.0',
    online: true,
    room: 'Living room',
    ...overrides,
  };
}

/** Stand-in for TclCloud: devices and shadows in memory, commands recorded. */
export class FakeCloud {
  constructor({ things = [thing()], shadows = { ac1: splitShadow() } } = {}) {
    this.things = things;
    this.shadows = shadows;
    this.commands = [];
    this.failNext = null;
  }

  async getThings() {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    return this.things.map((item) => ({ ...item }));
  }

  async getShadow(deviceId) {
    const reported = this.shadows[deviceId];
    return reported ? { reported: { ...reported }, desired: {}, delta: {} } : null;
  }

  async setDesired(deviceId, desired) {
    this.commands.push({ deviceId, desired });
    // The device applies the order: what a later read reports.
    this.shadows[deviceId] = { ...this.shadows[deviceId], ...desired };
  }
}

/**
 * A fake `fetch` answering the TCL and AWS endpoints the TclCloud calls.
 * `routes` maps a predicate on the URL to a handler `(url, init) => { status, body }`.
 */
export function createFakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of routes) {
      if (match(String(url), init)) {
        const { status = 200, body = {} } = await handler(String(url), init);
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
      }
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

/** The routes of a healthy account, overridable one by one. */
export function tclRoutes({
  now = Date.now(),
  login,
  things = [{ deviceId: 'ac1', nickName: 'Living room', deviceName: 'Split AC', isOnline: '1' }],
  shadow = splitShadow(),
} = {}) {
  const exp = Math.floor(now / 1000) + 3600;
  return [
    [
      (url) => url.startsWith('https://pa.account.tcl.com/'),
      login ??
        (() => ({
          body: {
            status: 1,
            token: jwt({ exp }),
            user: { username: 'user-42', countryAbbr: 'FR' },
          },
        })),
    ],
    [
      (url) => url.includes('/v3/global/cloud_url_get'),
      () => ({
        body: {
          code: 0,
          data: {
            cloud_region: 'eu-central-1',
            cloud_url: 'https://cloud.example',
            device_url: 'https://device.example',
          },
        },
      }),
    ],
    [
      (url) => url === 'https://cloud.example/v3/auth/refresh_tokens',
      () => ({
        body: {
          code: 0,
          data: {
            saasToken: jwt({ expiredDate: exp }),
            cognitoToken: jwt({ exp, sub: 'eu-central-1:identity' }),
          },
        },
      }),
    ],
    [
      (url) => url === 'https://cognito-identity.eu-central-1.amazonaws.com/',
      () => ({
        body: {
          IdentityId: 'eu-central-1:identity',
          Credentials: {
            AccessKeyId: 'AKID',
            SecretKey: 'SECRET',
            SessionToken: 'SESSION',
            Expiration: exp,
          },
        },
      }),
    ],
    [
      (url) => url === 'https://device.example/v3/user/get_things',
      () => ({ body: { code: 0, data: things } }),
    ],
    [
      (url, init) => url.includes('/things/') && url.endsWith('/shadow') && init.method === 'GET',
      () => ({ body: { state: { reported: shadow }, version: 1 } }),
    ],
    [(url) => url.includes('/topics/'), () => ({ body: { message: 'OK' } })],
  ];
}
