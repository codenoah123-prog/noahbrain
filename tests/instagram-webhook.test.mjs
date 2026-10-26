import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInstagramWebhook, readInstagramInbox, WEBHOOK_BODY_LIMIT} from '../server/instagram-webhook.mjs';

const secret = 'test-only-app-secret';
const verify = 'test-only-verify-token';
function signature(body) {return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');}
function payload(id = 'comment-1') {return {object: 'instagram', entry: [{id: 'account-1', changes: [{field: 'comments', value: {id, text: 'PRIVATE-COMMENT-CONTENT', from: {username: 'PRIVATE-USERNAME'}}}]}]};}
async function fixture(t, dbPath = ':memory:') {
  const app = createInstagramWebhook({appSecret: secret, verifyToken: verify, dbPath});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  return {...app, origin: `http://127.0.0.1:${app.server.address().port}`};
}
async function post(app, body, overrides = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(app.origin + '/webhooks/instagram', {method: 'POST', body: raw, headers: {'Content-Type': 'application/json', 'X-Hub-Signature-256': signature(raw), ...overrides}});
  return {status: response.status, body: await response.json()};
}

test('webhook verification returns only challenge after matching token and mode', async t => {
  const app = await fixture(t);
  const query = new URLSearchParams({'hub.mode': 'subscribe', 'hub.verify_token': verify, 'hub.challenge': 'test-challenge_123'});
  const response = await fetch(app.origin + '/webhooks/instagram?' + query);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  assert.equal(await response.text(), 'test-challenge_123');
  for (const patch of [{'hub.verify_token': 'incorrect'}, {'hub.mode': 'unsubscribe'}]) {
    const invalid = new URLSearchParams({...Object.fromEntries(query), ...patch});
    const rejected = await fetch(app.origin + '/webhooks/instagram?' + invalid);
    assert.equal(rejected.status, 401);
    assert.ok(!(await rejected.text()).includes(verify));
  }
  query.delete('hub.challenge');
  assert.equal((await fetch(app.origin + '/webhooks/instagram?' + query)).status, 400);
});

test('missing webhook secrets fail before creating any database', () => {
  const folder = mkdtempSync(join(tmpdir(), 'noahflow-webhook-config-'));
  try {
    const path = join(folder, 'not-created.sqlite');
    assert.throws(() => createInstagramWebhook({dbPath: path}), /META_APP_SECRET.*INSTAGRAM_WEBHOOK_VERIFY_TOKEN/);
    assert.equal(existsSync(path), false);
    assert.deepEqual(readInstagramInbox(path), {exists: false, receiptCount: 0, itemCount: 0, receipts: [], liveSendingEnabled: false});
    assert.equal(existsSync(path), false);
  } finally {rmSync(folder, {recursive: true, force: true});}
});

test('signed events are durable, deduplicated across formatting, and contain only minimal receipt metadata', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'noahflow 웹훅 확인 '));
  t.after(() => rmSync(folder, {recursive: true, force: true}));
  const path = join(folder, 'inbox.sqlite');
  const app = await fixture(t, path);
  const first = await post(app, payload());
  assert.deepEqual(first, {status: 200, body: {received: true, duplicate: false, liveSendingEnabled: false}});
  const formatted = JSON.stringify({entry: payload().entry, object: 'instagram'}, null, 2);
  assert.equal((await post(app, formatted)).body.duplicate, true);
  assert.equal((await post(app, payload('comment-2'))).body.duplicate, false);
  const status = readInstagramInbox(path);
  assert.equal(status.receiptCount, 2);
  assert.equal(status.itemCount, 2);
  assert.equal(status.liveSendingEnabled, false);
  assert.deepEqual(Object.keys(status.receipts[0]).sort(), ['fields', 'id', 'itemCount', 'receivedAt']);
  assert.deepEqual(status.receipts[0].fields, ['comments']);
  assert.match(status.receipts[0].id, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(status).includes('PRIVATE-'));
  await app.close();
  const stored = readFileSync(path).toString('latin1');
  assert.ok(!stored.includes('PRIVATE-COMMENT-CONTENT'));
  assert.ok(!stored.includes('PRIVATE-USERNAME'));
  assert.ok(!stored.includes(secret));
  assert.ok(!stored.includes(verify));
  const reopened = await fixture(t, path);
  assert.equal((await post(reopened, payload())).body.duplicate, true);
  assert.equal(reopened.summary().receiptCount, 2);
});

test('raw-body HMAC rejects missing, malformed, wrong, and tampered signatures without storing events', async t => {
  const app = await fixture(t);
  for (const value of ['', 'sha256=not-hex', 'sha256=' + '0'.repeat(64), 'sha1=' + '0'.repeat(40)]) {
    const rejected = await post(app, payload(), {'X-Hub-Signature-256': value});
    assert.equal(rejected.status, 403);
  }
  const raw = JSON.stringify(payload());
  const whitespaceTamper = await post(app, raw + ' ', {'X-Hub-Signature-256': signature(raw)});
  assert.equal(whitespaceTamper.status, 403);
  assert.equal(app.summary().receiptCount, 0);
  assert.equal((await post(app, raw + ' ')).status, 200);
});

test('malformed JSON, invalid event shapes, wrong content type and oversized bodies fail before receipt creation', async t => {
  const app = await fixture(t);
  assert.equal((await post(app, '{')).status, 400);
  for (const invalid of [null, {}, {object: 'page', entry: []}, {object: 'instagram', entry: []}, {object: 'instagram', entry: [{changes: 'bad'}]}, {object: 'instagram', entry: [{id: 'empty'}]}]) {
    assert.equal((await post(app, invalid)).status, 400);
  }
  assert.equal((await post(app, payload(), {'Content-Type': 'text/plain'})).status, 415);
  const huge = ' '.repeat(WEBHOOK_BODY_LIMIT + 1);
  assert.equal((await post(app, huge)).status, 413);
  assert.equal(app.summary().receiptCount, 0);
});

test('dedicated receiver exposes no management routes and never sends messages', async t => {
  const app = await fixture(t);
  const health = await fetch(app.origin + '/health');
  assert.deepEqual(await health.json(), {ok: true, mode: 'receive_only', liveSendingEnabled: false});
  for (const path of ['/', '/api/health', '/api/automations', '/api/deliveries', '/data/instagram-inbox.sqlite']) {
    assert.equal((await fetch(app.origin + path)).status, 404);
  }
  const event = {object: 'instagram', entry: [{messaging: [{sender: {id: 'private-user'}, message: {mid: 'message-1', text: 'PRIVATE-REPLY-TEXT'}}, {postback: {payload: 'PRIVATE-POSTBACK'}}]}]};
  assert.equal((await post(app, event)).status, 200);
  const receipt = app.receipts()[0];
  assert.equal(receipt.itemCount, 2);
  assert.deepEqual(receipt.fields, ['messages', 'messaging_postbacks']);
  assert.ok(!JSON.stringify(receipt).includes('PRIVATE-'));
  assert.equal(app.summary().liveSendingEnabled, false);
});
