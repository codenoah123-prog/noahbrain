import { createServer } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_INBOX_PATH = fileURLToPath(new URL('../data/instagram-inbox.sqlite', import.meta.url));
export const WEBHOOK_BODY_LIMIT = 256 * 1024;
const FIELD_NAMES = new Set(['comments', 'messages', 'messaging_postbacks', 'messaging_seen', 'message_reactions', 'mentions', 'live_comments', 'standby']);

class WebhookError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function sameSecret(left, right) {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}
function json(response, status, value) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  response.end(JSON.stringify(value));
}
function canonical(value, depth = 0) {
  if (depth > 30) throw new WebhookError(400, 'INVALID_PAYLOAD', '이벤트 구조가 너무 깊습니다.');
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
  return JSON.stringify(value);
}
function eventMetadata(payload) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry) || !payload.entry.length || payload.entry.length > 100) {
    throw new WebhookError(400, 'INVALID_PAYLOAD', 'Instagram 이벤트 구조를 확인해 주세요.');
  }
  const fields = new Set();
  let itemCount = 0;
  for (const entry of payload.entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new WebhookError(400, 'INVALID_PAYLOAD', '이벤트 항목이 올바르지 않습니다.');
    if (entry.changes !== undefined) {
      if (!Array.isArray(entry.changes)) throw new WebhookError(400, 'INVALID_PAYLOAD', '변경 이벤트 목록이 올바르지 않습니다.');
      for (const change of entry.changes) {
        if (!change || typeof change !== 'object' || Array.isArray(change) || typeof change.field !== 'string') throw new WebhookError(400, 'INVALID_PAYLOAD', '변경 이벤트가 올바르지 않습니다.');
        fields.add(FIELD_NAMES.has(change.field) ? change.field : 'other');
        itemCount++;
      }
    }
    if (entry.messaging !== undefined) {
      if (!Array.isArray(entry.messaging)) throw new WebhookError(400, 'INVALID_PAYLOAD', '메시지 이벤트 목록이 올바르지 않습니다.');
      for (const message of entry.messaging) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new WebhookError(400, 'INVALID_PAYLOAD', '메시지 이벤트가 올바르지 않습니다.');
        fields.add(message.postback ? 'messaging_postbacks' : message.read ? 'messaging_seen' : message.reaction ? 'message_reactions' : 'messages');
        itemCount++;
      }
    }
  }
  if (!itemCount) throw new WebhookError(400, 'INVALID_PAYLOAD', '수신할 이벤트 항목이 없습니다.');
  return {fields: [...fields].sort(), itemCount};
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const chunks = [];
    const fail = error => { if (!settled) { settled = true; chunks.length = 0; reject(error); } };
    request.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > WEBHOOK_BODY_LIMIT) fail(new WebhookError(413, 'BODY_TOO_LARGE', '웹훅 본문이 너무 큽니다.'));
      else chunks.push(chunk);
    });
    request.once('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    request.once('error', () => fail(new WebhookError(400, 'BODY_ERROR', '웹훅 본문을 읽지 못했습니다.')));
    request.once('aborted', () => fail(new WebhookError(400, 'BODY_ERROR', '웹훅 요청이 중단되었습니다.')));
  });
}
function receiptRows(database) {
  return database.prepare('SELECT id,received_at,fields,item_count FROM instagram_receipts ORDER BY rowid DESC LIMIT 100').all().map(row => ({id: row.id, receivedAt: row.received_at, fields: JSON.parse(row.fields), itemCount: row.item_count}));
}
export function readInstagramInbox(dbPath = DEFAULT_INBOX_PATH) {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return {exists: false, receiptCount: 0, itemCount: 0, receipts: [], liveSendingEnabled: false};
  const database = new DatabaseSync(dbPath, {readOnly: true});
  try {
    const totals = database.prepare('SELECT count(*) AS receipt_count,coalesce(sum(item_count),0) AS item_count FROM instagram_receipts').get();
    return {exists: true, receiptCount: totals.receipt_count, itemCount: totals.item_count, receipts: receiptRows(database), liveSendingEnabled: false};
  } finally { database.close(); }
}

export function createInstagramWebhook({appSecret, verifyToken, dbPath = DEFAULT_INBOX_PATH} = {}) {
  const missing = [];
  if (typeof appSecret !== 'string' || !appSecret.trim()) missing.push('META_APP_SECRET');
  if (typeof verifyToken !== 'string' || !verifyToken.trim()) missing.push('INSTAGRAM_WEBHOOK_VERIFY_TOKEN');
  if (missing.length) throw new Error('웹훅 설정이 필요합니다: ' + missing.join(', '));
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), {recursive: true});
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS instagram_receipts (id TEXT PRIMARY KEY,received_at TEXT NOT NULL,fields TEXT NOT NULL,item_count INTEGER NOT NULL)');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, {ok: true, mode: 'receive_only', liveSendingEnabled: false});
      if (url.pathname !== '/webhooks/instagram') { request.resume(); return json(response, 404, {error: {code: 'NOT_FOUND', message: '수신 경로가 없습니다.'}}); }
      if (request.method === 'GET') {
        const candidate = url.searchParams.get('hub.verify_token') || '';
        const challenge = url.searchParams.get('hub.challenge');
        if (url.searchParams.get('hub.mode') !== 'subscribe' || !candidate || candidate.length > 1024 || !sameSecret(candidate, verifyToken)) throw new WebhookError(401, 'VERIFY_FAILED', '웹훅 검증에 실패했습니다.');
        if (challenge === null || !challenge || challenge.length > 1024) throw new WebhookError(400, 'INVALID_CHALLENGE', '검증 요청을 확인해 주세요.');
        response.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
        return response.end(challenge);
      }
      if (request.method !== 'POST') { request.resume(); throw new WebhookError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.'); }
      const signature = request.headers['x-hub-signature-256'];
      if (typeof signature !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) { request.resume(); throw new WebhookError(403, 'INVALID_SIGNATURE', '웹훅 서명을 확인할 수 없습니다.'); }
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { request.resume(); throw new WebhookError(415, 'CONTENT_TYPE', 'application/json 요청만 지원합니다.'); }
      const raw = await readBody(request);
      const expected = createHmac('sha256', appSecret).update(raw).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new WebhookError(403, 'INVALID_SIGNATURE', '웹훅 서명을 확인할 수 없습니다.');
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); }
      catch { throw new WebhookError(400, 'INVALID_JSON', '웹훅 JSON을 확인해 주세요.'); }
      const metadata = eventMetadata(payload);
      const id = createHash('sha256').update(canonical(payload)).digest('hex');
      const result = database.prepare('INSERT OR IGNORE INTO instagram_receipts VALUES (?,?,?,?)').run(id, new Date().toISOString(), JSON.stringify(metadata.fields), metadata.itemCount);
      return json(response, 200, {received: true, duplicate: result.changes === 0, liveSendingEnabled: false});
    } catch (error) {
      if (error instanceof WebhookError) return json(response, error.status, {error: {code: error.code, message: error.message}});
      return json(response, 500, {error: {code: 'INTERNAL_ERROR', message: '웹훅을 저장하지 못했습니다.'}});
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 30;
  let closed = false;
  const close = () => new Promise((resolve, reject) => {
    if (closed) return resolve();
    closed = true;
    if (!server.listening) { database.close(); return resolve(); }
    server.close(error => { database.close(); error ? reject(error) : resolve(); });
  });
  return {server, close, receipts: () => receiptRows(database), summary: () => ({receiptCount: database.prepare('SELECT count(*) AS total FROM instagram_receipts').get().total, liveSendingEnabled: false})};
}
