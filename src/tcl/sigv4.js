// -----------------------------------------------------------------------------
// AWS Signature Version 4, the minimum the AWS IoT data plane needs.
//
// The TCL Home app reads and writes its devices through the AWS IoT "device
// shadow" REST API, with temporary credentials from Amazon Cognito. Pulling the
// whole AWS SDK into the image for two signed HTTP calls would weigh more than
// the integration itself: this file signs the requests with `node:crypto` only.
//
// Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
// test/sigv4.test.js checks it against the official test vector.
// -----------------------------------------------------------------------------

import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';

const sha256Hex = (data) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * Percent-encode like AWS expects (RFC 3986: only A-Z a-z 0-9 - _ . ~ stay).
 * @param {string} value
 */
export function awsEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `20150830T123600Z` for a date. */
export function amzDate(date) {
  return date
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Sign one HTTP request.
 *
 * Every service but S3 encodes the path TWICE in the canonical request: the
 * path of the URL is already percent-encoded (a topic `$aws/things/x` travels
 * as `%24aws%2Fthings%2Fx`), and the signature encodes each segment again.
 *
 * @param {object} request
 * @param {string} request.method HTTP method
 * @param {string} request.url full URL, path already percent-encoded
 * @param {Record<string, string>} [request.headers] headers to sign and send
 * @param {string} [request.body] request body ('' when none)
 * @param {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string }} request.credentials
 * @param {string} request.region e.g. eu-central-1
 * @param {string} request.service e.g. iotdata
 * @param {Date} [request.date] signing time
 * @returns {Record<string, string>} the headers to send, Authorization included
 */
export function signRequest({
  method,
  url,
  headers = {},
  body = '',
  credentials,
  region,
  service,
  date = new Date(),
}) {
  const target = new URL(url);
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);

  const sent = {};
  for (const [name, value] of Object.entries(headers)) {
    sent[name.toLowerCase()] = String(value);
  }
  sent.host = target.host;
  sent['x-amz-date'] = stamp;
  if (credentials.sessionToken) {
    sent['x-amz-security-token'] = credentials.sessionToken;
  }

  const canonicalUri =
    target.pathname
      .split('/')
      .map((segment) => awsEncode(segment))
      .join('/') || '/';

  const canonicalQuery = [...target.searchParams.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const names = Object.keys(sent).sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${sent[name].trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    ...sent,
    authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
