import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INSTAGRAM_REQUIRED_ENV, probeInstagram, readinessStatus } from '../server/instagram.mjs';

const token = 'test-secret-not-a-real-token';
const env = { INSTAGRAM_LOGIN_MODE: 'instagram', INSTAGRAM_API_VERSION: 'v24.0', INSTAGRAM_ACCOUNT_ID: '178400000000001', INSTAGRAM_ACCESS_TOKEN: token };
const response = payload => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('readiness exposes only variable names and never treats configured credentials as verified permissions', () => {
  const absent = readinessStatus({});
  assert.deepEqual(absent.missing, [...INSTAGRAM_REQUIRED_ENV]);
  assert.equal(absent.configured, false);
  const present = readinessStatus(env);
  assert.equal(present.status, 'credentials_present_unverified');
  assert.deepEqual(present.checks, { subscriptionRead: false, comments: false, messaging: false, followLookup: false });
  assert.equal(present.liveSendingEnabled, false);
  assert.equal(JSON.stringify(present).includes(token), false);
  assert.equal(JSON.stringify(present).includes(env.INSTAGRAM_ACCOUNT_ID), false);
});

test('missing, malformed or unsupported login settings make no network request', async () => {
  const cases = [{}, { ...env, INSTAGRAM_LOGIN_MODE: 'facebook' }, { ...env, INSTAGRAM_API_VERSION: 'v24.0/../../../attacker' }, { ...env, INSTAGRAM_ACCOUNT_ID: 'https://attacker.test/' }, { ...env, INSTAGRAM_ACCESS_TOKEN: 'header\ninjection' }];
  for (const invalid of cases) {
    const result = await probeInstagram({ env: invalid, fetchImpl: () => assert.fail('must not fetch with invalid configuration') });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CONFIGURATION_REQUIRED');
  }
});

test('probe uses one GET to the fixed official host, protects Bearer authentication and limits claims', async () => {
  let calls = 0;
  const result = await probeInstagram({ env, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://graph.instagram.com/v24.0/178400000000001/subscribed_apps');
    assert.equal(new URL(url).search, '');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return response({ data: [{ id: 'private-app-id', subscribed_fields: ['comments', 'messages', 'messages', 'messaging_postbacks', 'irrelevant_private_field'] }] });
  } });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.subscriptions.fields, ['comments', 'messages', 'messaging_postbacks']);
  assert.equal(result.subscriptions.hasComments, true);
  assert.equal(result.subscriptions.hasMessages, true);
  assert.deepEqual(result.checks, { subscriptionRead: true, comments: false, messaging: false, followLookup: false });
  assert.equal(result.appIdentityVerified, false);
  assert.equal(result.liveSendingEnabled, false);
  for (const secret of [token, 'private-app-id', 'irrelevant_private_field', env.INSTAGRAM_ACCOUNT_ID]) assert.equal(JSON.stringify(result).includes(secret), false);
});

test('an empty subscription list is reported without fabricating subscribed fields', async () => {
  const result = await probeInstagram({ env, fetchImpl: async () => response({ data: [] }) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.subscriptions, { appCount: 0, fields: [], hasComments: false, hasMessages: false });
});

test('Graph authorization errors report only bounded numeric metadata, never raw messages or secrets', async () => {
  const result = await probeInstagram({ env, fetchImpl: async () => new Response(JSON.stringify({ error: { message: `secret ${token}`, code: 190, error_subcode: 463, type: token, fbtrace_id: token } }), { status: 401 }) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GRAPH_REQUEST_REJECTED');
  assert.equal(result.error.graphCode, 190);
  assert.equal(result.error.graphSubcode, 463);
  assert.equal(result.error.httpStatus, 401);
  assert.equal(JSON.stringify(result).includes(token), false);
  const malformed = await probeInstagram({ env, fetchImpl: async () => new Response(JSON.stringify({ error: { message: token, code: token, error_subcode: token } }), { status: 400 }) });
  assert.equal(malformed.error.graphCode, undefined);
  assert.equal(malformed.error.graphSubcode, undefined);
  assert.equal(JSON.stringify(malformed).includes(token), false);
});

test('network/redirect failures and invalid JSON cannot echo credential-bearing exception messages', async () => {
  const result = await probeInstagram({ env, fetchImpl: async () => { throw new Error(`redirect failed for ${token}`); } });
  assert.equal(result.error.code, 'PROBE_REQUEST_FAILED');
  assert.equal(JSON.stringify(result).includes(token), false);
  const invalid = await probeInstagram({ env, fetchImpl: async () => new Response(token, { status: 200 }) });
  assert.equal(invalid.error.code, 'PROBE_REQUEST_FAILED');
  assert.equal(JSON.stringify(invalid).includes(token), false);
});

test('malformed successful responses do not establish a readable subscription result', async () => {
  for (const payload of [null, {}, { data: {} }, { data: [{ subscribed_fields: 'messages' }] }, { data: [{ subscribed_fields: [token, 4] }] }]) {
    const result = await probeInstagram({ env, fetchImpl: async () => response(payload) });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNEXPECTED_RESPONSE');
    assert.equal(result.checks.subscriptionRead, false);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('probe aborts a stalled request and never retries or changes to a write method', async () => {
  let calls = 0;
  const result = await probeInstagram({ env, timeoutMs: 15, fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.method, 'GET');
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(token)), { once: true }));
  } });
  assert.equal(calls, 1);
  assert.equal(result.error.code, 'PROBE_TIMEOUT');
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('CLI missing configuration exits nonzero and prints names rather than environment values', () => {
  const childEnv = { ...process.env };
  for (const name of INSTAGRAM_REQUIRED_ENV) delete childEnv[name];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-instagram.mjs', import.meta.url))], { env: childEnv, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CONFIGURATION_REQUIRED/);
  assert.match(result.stderr, /INSTAGRAM_ACCESS_TOKEN/);
  assert.match(result.stderr, /docs\/INSTAGRAM-READINESS\.md/);
  assert.equal(result.stdout, '');
});
