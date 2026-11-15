import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amzDate, awsEncode, signRequest } from '../src/tcl/sigv4.js';

test('signs the official AWS "get-vanilla" test vector', () => {
  // aws-sig-v4-test-suite/get-vanilla
  const headers = signRequest({
    method: 'GET',
    url: 'https://example.amazonaws.com/',
    credentials: {
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    },
    region: 'us-east-1',
    service: 'service',
    date: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(
    headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, ' +
      'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
});

test('signs an AWS IoT shadow publish exactly like botocore', () => {
  // Same request signed by botocore 1.44 (iot-data publish): the topic travels
  // encoded once in the URL and is encoded twice in the signature.
  const headers = signRequest({
    method: 'POST',
    url:
      'https://data-ats.iot.eu-central-1.amazonaws.com/topics/' +
      '%24aws%2Fthings%2Fabc%2Fshadow%2Fupdate?qos=1&contentType=application%2Fjson',
    body: '{"a":1}',
    credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' },
    region: 'eu-central-1',
    service: 'iotdata',
    date: new Date('2026-11-15T22:12:28Z'),
  });
  assert.equal(headers['x-amz-security-token'], 'TOKEN');
  assert.equal(headers['x-amz-date'], '20261115T221228Z');
  assert.match(
    headers.authorization,
    /SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=476f26bbd60d9c8414ab3cef06188900d76bd2636b88987d4fd111c15dcc5570$/,
  );
});

test('encodes like RFC 3986 and formats the AWS date', () => {
  assert.equal(awsEncode("a b!'()*~"), 'a%20b%21%27%28%29%2A~');
  assert.equal(amzDate(new Date('2026-01-02T03:04:05.678Z')), '20260102T030405Z');
});
