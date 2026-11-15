// -----------------------------------------------------------------------------
// The TCL Home cloud, as the official mobile app talks to it.
//
// TCL publishes no API: these calls are the ones the TCL Home app makes, as
// documented by the community (the Home Assistant "tcl_home_unofficial"
// integration). A session takes five steps, each one cached until it expires:
//
//   1. account login      pa.account.tcl.com        -> sso token (JWT) + user
//   2. cloud URLs         prod-center.aws.tcljd.com -> region, cloud and device URLs
//   3. app tokens         <cloud_url>/v3/auth/refresh_tokens -> saas token, Cognito token
//   4. AWS credentials    Cognito GetCredentialsForIdentity  -> temporary AWS keys
//   5. device shadows     AWS IoT data plane (REST, SigV4)   -> read / write the state
//
// Steps 1 to 3 talk to TCL, steps 4 and 5 to AWS. The device list itself comes
// from TCL (`get_things`), the state of each device from AWS IoT (its "thing
// shadow": `reported` is what the device says, `desired` what was asked).
//
// Everything is cloud: TCL appliances have no documented local API.
//
// Secrets (password, tokens, AWS keys) are never logged, never thrown in an
// error message, and only kept in memory: a restart logs in again.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { signRequest } from './sigv4.js';

export const TCL_LOGIN_URL = 'https://pa.account.tcl.com/account/login?clientId=54148614';
export const TCL_CLOUD_URLS_URL = 'https://prod-center.aws.tcljd.com/v3/global/cloud_url_get';
export const TCL_APP_ID = 'wx6e1af3fa84fbe523';

/** Version strings of the app the calls mimic: the TCL servers check them. */
const APP_VERSION = '5.4.1';
const THOME_VERSION = '4.8.1';

/** How long before its expiry a token is renewed. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** One HTTP call never waits longer than this. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The AWS IoT service name in SigV4 signatures (not `iot-data`). */
const IOT_SIGNING_SERVICE = 'iotdata';

/** The user name or password is refused: retrying will not help. */
export class TclAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TclAuthError';
  }
}

/** Any other failure of the TCL or AWS side (network, 5xx, unexpected answer). */
export class TclCloudError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'TclCloudError';
    this.status = status;
  }
}

/** Lowercase hex MD5, as TCL hashes the password and signs its calls. */
export function md5(text) {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

/**
 * The claims of a JWT, without checking its signature (we only read the expiry
 * and the Cognito identity id the server put in it).
 * @returns {Record<string, unknown>} `{}` when the token cannot be read
 */
export function jwtClaims(token) {
  try {
    const payload = String(token).split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * When a token or a credential expires, in milliseconds since the epoch.
 * TCL and AWS give seconds; a value already in milliseconds is kept.
 * @returns {number} 0 when unknown (the caller then treats it as expired)
 */
export function expiryMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 1e12 ? number : number * 1000;
}

/** First defined value among several spellings of the same key. */
function pick(object, ...keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

/**
 * One device of the account, as `get_things` lists it, under stable names.
 * TCL answers camelCase or snake_case depending on the region: both are read.
 */
export function normalizeThing(raw) {
  let room = pick(raw, 'room');
  if (room === undefined && Array.isArray(raw.labels)) {
    room = raw.labels.find((label) => label?.labelKey === 'room')?.labelValue;
  }
  const deviceName = pick(raw, 'deviceName', 'device_name') ?? '';
  return {
    deviceId: String(pick(raw, 'deviceId', 'device_id') ?? ''),
    // What the user called it in the app, the room otherwise, the model last.
    name: String(pick(raw, 'nickName', 'nick_name') ?? room ?? deviceName ?? 'TCL'),
    deviceName: String(deviceName),
    category: String(pick(raw, 'category') ?? ''),
    productKey: String(pick(raw, 'productKey', 'product_key') ?? ''),
    firmwareVersion: String(pick(raw, 'firmwareVersion', 'firmware_version') ?? ''),
    online: Number(pick(raw, 'isOnline', 'is_online') ?? 0) === 1,
    room: room === undefined ? '' : String(room),
  };
}

/**
 * A TCL Home session: logs in on demand, keeps every token until it expires,
 * and exposes the four operations the integration needs.
 */
export class TclCloud {
  /**
   * @param {object} options
   * @param {string} options.username TCL Home account (e-mail)
   * @param {string} options.password its password, in clear: hashed before sending
   * @param {typeof fetch} [options.fetch] HTTP client (tests inject a fake)
   * @param {() => number} [options.now] clock, in milliseconds
   * @param {{ debug: Function, info: Function }} [options.logger]
   */
  constructor({ username, password, fetch = globalThis.fetch, now = Date.now, logger } = {}) {
    this.username = username;
    this.passwordHash = md5(password ?? '');
    this.fetch = fetch;
    this.now = now;
    this.logger = logger;
    this.auth = null; // { token, username, country, expiresAt }
    this.urls = null; // { region, cloudUrl, deviceUrl }
    this.tokens = null; // { saasToken, cognitoToken, expiresAt }
    this.aws = null; // { accessKeyId, secretAccessKey, sessionToken, expiresAt }
  }

  /** The AWS region of the account, known after the first successful call. */
  get region() {
    return this.urls?.region ?? null;
  }

  /** Forget everything: the next call starts again from the login. */
  reset() {
    this.auth = null;
    this.urls = null;
    this.tokens = null;
    this.aws = null;
  }

  // --- HTTP ------------------------------------------------------------------

  async request(url, { method = 'POST', headers = {}, body, what }) {
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // The cause names the network problem (DNS, timeout...), never a secret.
      throw new TclCloudError(`${what}: network error (${err?.cause?.code ?? err?.name ?? err})`);
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: reported below with the HTTP status.
    }
    return { status: response.status, ok: response.ok, json };
  }

  /** Headers of the TCL "saas" API calls: a timestamp, a nonce and their MD5. */
  saasHeaders(saasToken) {
    const timestamp = String(this.now());
    const nonce = randomBytes(8).toString('hex');
    return {
      platform: 'android',
      appversion: APP_VERSION,
      thomeversion: THOME_VERSION,
      accesstoken: saasToken,
      'accept-language': 'en',
      timestamp,
      nonce,
      sign: md5(timestamp + nonce + saasToken),
      'user-agent': 'Android',
      'content-type': 'application/json; charset=UTF-8',
    };
  }

  isFresh(expiresAt) {
    return expiresAt > this.now() + EXPIRY_MARGIN_MS;
  }

  // --- Session steps ---------------------------------------------------------

  async login() {
    const { status, json } = await this.request(TCL_LOGIN_URL, {
      what: 'TCL login',
      headers: {
        th_platform: 'android',
        th_version: THOME_VERSION,
        th_appbulid: '830',
        'user-agent': 'Android',
        'content-type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        equipment: 2,
        password: this.passwordHash,
        osType: 1,
        username: this.username,
        clientVersion: THOME_VERSION,
        osVersion: '6.0',
        deviceModel: 'Gladys',
        captchaRule: 2,
        channel: 'app',
      }),
    });
    if (status !== 200 || !json) {
      throw new TclCloudError(`TCL login: HTTP ${status}`, { status });
    }
    if (Number(json.status) !== 1 || !json.token) {
      // TCL answers 200 with another status for a wrong e-mail or password.
      throw new TclAuthError(
        `TCL login refused (status ${json.status}${json.msg ? `: ${json.msg}` : ''})`,
      );
    }
    const user = json.user ?? {};
    this.auth = {
      token: json.token,
      username: String(user.username ?? this.username),
      country: String(pick(user, 'countryAbbr', 'country_abbr') ?? ''),
      expiresAt: expiryMs(jwtClaims(json.token).exp) || this.now() + 60 * 60 * 1000,
    };
    this.logger?.debug('TCL login succeeded');
    return this.auth;
  }

  async loadCloudUrls() {
    const { status, json } = await this.request(TCL_CLOUD_URLS_URL, {
      what: 'TCL cloud URLs',
      headers: { 'user-agent': 'Android', 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ ssoId: this.auth.username, ssoToken: this.auth.token }),
    });
    const data = json?.data;
    if (status !== 200 || !data?.cloud_url || !data?.device_url || !data?.cloud_region) {
      throw new TclCloudError(`TCL cloud URLs: HTTP ${status}, code ${json?.code}`, { status });
    }
    this.urls = { region: data.cloud_region, cloudUrl: data.cloud_url, deviceUrl: data.device_url };
    this.logger?.debug(`TCL cloud region: ${this.urls.region}`);
    return this.urls;
  }

  async refreshTokens() {
    const { status, json } = await this.request(`${this.urls.cloudUrl}/v3/auth/refresh_tokens`, {
      what: 'TCL tokens',
      headers: { 'user-agent': 'Android', 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        userId: this.auth.username,
        ssoToken: this.auth.token,
        appId: TCL_APP_ID,
      }),
    });
    const data = json?.data ?? {};
    const saasToken = pick(data, 'saasToken', 'saas_token');
    const cognitoToken = pick(data, 'cognitoToken', 'cognito_token');
    if (status !== 200 || !saasToken || !cognitoToken) {
      throw new TclCloudError(`TCL tokens: HTTP ${status}, code ${json?.code}`, { status });
    }
    const saasExpiry = expiryMs(jwtClaims(saasToken).expiredDate ?? jwtClaims(saasToken).exp);
    const cognitoExpiry = expiryMs(jwtClaims(cognitoToken).exp);
    this.tokens = {
      saasToken,
      cognitoToken,
      expiresAt:
        Math.min(...[saasExpiry, cognitoExpiry].filter((value) => value > 0)) ||
        this.now() + 30 * 60 * 1000,
    };
    return this.tokens;
  }

  async loadAwsCredentials() {
    const identityId = jwtClaims(this.tokens.cognitoToken).sub;
    if (!identityId) {
      throw new TclCloudError('AWS credentials: the Cognito token carries no identity');
    }
    const { status, json } = await this.request(
      `https://cognito-identity.${this.urls.region}.amazonaws.com/`,
      {
        what: 'AWS credentials',
        headers: {
          'x-amz-target': 'AWSCognitoIdentityService.GetCredentialsForIdentity',
          'content-type': 'application/x-amz-json-1.1',
        },
        body: JSON.stringify({
          IdentityId: identityId,
          Logins: { 'cognito-identity.amazonaws.com': this.tokens.cognitoToken },
        }),
      },
    );
    const credentials = json?.Credentials;
    if (status !== 200 || !credentials?.AccessKeyId || !credentials?.SecretKey) {
      throw new TclCloudError(`AWS credentials: HTTP ${status}`, { status });
    }
    this.aws = {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretKey,
      sessionToken: credentials.SessionToken,
      expiresAt: expiryMs(credentials.Expiration) || this.now() + 30 * 60 * 1000,
    };
    return this.aws;
  }

  /** Run the steps whose result is missing or about to expire. */
  async ensureSession({ aws = false } = {}) {
    if (!this.auth || !this.isFresh(this.auth.expiresAt)) {
      // A new login invalidates what was derived from the previous one.
      this.tokens = null;
      this.aws = null;
      await this.login();
    }
    if (!this.urls) await this.loadCloudUrls();
    if (!this.tokens || !this.isFresh(this.tokens.expiresAt)) {
      this.aws = null;
      await this.refreshTokens();
    }
    if (aws && (!this.aws || !this.isFresh(this.aws.expiresAt))) {
      await this.loadAwsCredentials();
    }
  }

  // --- Operations ------------------------------------------------------------

  /** Every device of the account, normalized (see normalizeThing). */
  async getThings({ retried = false } = {}) {
    await this.ensureSession();
    const { status, json } = await this.request(`${this.urls.deviceUrl}/v3/user/get_things`, {
      what: 'TCL device list',
      headers: this.saasHeaders(this.tokens.saasToken),
      body: '{}',
    });
    if (status === 200 && Array.isArray(json?.data)) {
      return json.data.map(normalizeThing).filter((thing) => thing.deviceId);
    }
    if (!retried && (status === 401 || status === 403 || (json && Number(json.code) !== 0))) {
      // The saas token was revoked before its announced expiry: one fresh try.
      this.tokens = null;
      return this.getThings({ retried: true });
    }
    throw new TclCloudError(`TCL device list: HTTP ${status}, code ${json?.code}`, { status });
  }

  /** The data plane host of the account region (the one the AWS SDK uses). */
  iotHost() {
    return `data-ats.iot.${this.urls.region}.amazonaws.com`;
  }

  async signedIot(method, path, body = '', { retried = false } = {}) {
    await this.ensureSession({ aws: true });
    const url = `https://${this.iotHost()}${path}`;
    const headers = signRequest({
      method,
      url,
      body,
      credentials: this.aws,
      region: this.urls.region,
      service: IOT_SIGNING_SERVICE,
      date: new Date(this.now()),
    });
    const result = await this.request(url, {
      method,
      headers,
      body: body || undefined,
      what: 'AWS IoT',
    });
    if (!retried && (result.status === 401 || result.status === 403)) {
      // Expired or revoked AWS credentials: renew them once.
      this.aws = null;
      return this.signedIot(method, path, body, { retried: true });
    }
    return result;
  }

  /**
   * The shadow of one device: `{ reported, desired, delta }` (plain objects).
   * @returns {Promise<object|null>} null when the device has no shadow (a TCL
   *   TV, a device not on AWS IoT): nothing to read there
   */
  async getShadow(deviceId) {
    const { status, json } = await this.signedIot(
      'GET',
      `/things/${encodeURIComponent(deviceId)}/shadow`,
    );
    if (status === 404) return null;
    if (status !== 200 || !json) {
      throw new TclCloudError(`AWS IoT shadow of ${deviceId}: HTTP ${status}`, { status });
    }
    return {
      reported: json.state?.reported ?? {},
      desired: json.state?.desired ?? {},
      delta: json.state?.delta ?? {},
    };
  }

  /**
   * Ask a device to change: publishes `{ state: { desired } }` on its shadow
   * update topic, exactly like the app. The device applies it within a second
   * or two and reports its new state in the shadow.
   */
  async setDesired(deviceId, desired) {
    const topic = `$aws/things/${deviceId}/shadow/update`;
    const body = JSON.stringify({
      state: { desired },
      clientToken: `mobile_${Math.floor(this.now() / 1000)}`,
    });
    const { status } = await this.signedIot(
      'POST',
      `/topics/${encodeURIComponent(topic)}?qos=1`,
      body,
    );
    if (status !== 200) {
      throw new TclCloudError(`AWS IoT command to ${deviceId}: HTTP ${status}`, { status });
    }
  }
}
