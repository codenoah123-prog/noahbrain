// Read-only endpoint documented in Meta's official Instagram Login collection:
// https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/postman/instagram-platform-api.postman_collection.json
// This module never subscribes an app, sends a message, or reads follower state.
export const INSTAGRAM_REQUIRED_ENV = Object.freeze([
  'INSTAGRAM_LOGIN_MODE',
  'INSTAGRAM_API_VERSION',
  'INSTAGRAM_ACCOUNT_ID',
  'INSTAGRAM_ACCESS_TOKEN',
]);
export const PROBE_TIMEOUT_MS = 8000;
const OBSERVED_FIELDS = new Set(['comments', 'messages', 'messaging_postbacks']);

function noLiveChecks(subscriptionRead = false) {
  return { subscriptionRead, comments: false, messaging: false, followLookup: false };
}

function configuration(env) {
  const missing = INSTAGRAM_REQUIRED_ENV.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  const invalid = [];
  const present = name => !missing.includes(name);
  if (present('INSTAGRAM_LOGIN_MODE') && env.INSTAGRAM_LOGIN_MODE !== 'instagram') invalid.push('INSTAGRAM_LOGIN_MODE');
  if (present('INSTAGRAM_API_VERSION') && !/^v[1-9]\d{0,2}\.\d{1,2}$/.test(env.INSTAGRAM_API_VERSION)) invalid.push('INSTAGRAM_API_VERSION');
  if (present('INSTAGRAM_ACCOUNT_ID') && !/^\d{1,40}$/.test(env.INSTAGRAM_ACCOUNT_ID)) invalid.push('INSTAGRAM_ACCOUNT_ID');
  if (present('INSTAGRAM_ACCESS_TOKEN') && (env.INSTAGRAM_ACCESS_TOKEN.length > 8192 || /[\s\u0000-\u001f\u007f]/u.test(env.INSTAGRAM_ACCESS_TOKEN))) invalid.push('INSTAGRAM_ACCESS_TOKEN');
  return { missing, invalid };
}

export function readinessStatus(env = process.env) {
  const { missing, invalid } = configuration(env);
  const configured = missing.length === 0 && invalid.length === 0;
  return {
    configured,
    status: configured ? 'credentials_present_unverified' : 'configuration_required',
    required: [...INSTAGRAM_REQUIRED_ENV],
    missing,
    invalid,
    checks: noLiveChecks(),
    liveSendingEnabled: false,
  };
}

function failure(readiness, code, message, metadata = {}) {
  return { ok: false, readiness, error: { code, message, ...metadata }, checks: noLiveChecks(), liveSendingEnabled: false };
}

function graphMetadata(body, status) {
  const metadata = {};
  if (Number.isInteger(status) && status >= 100 && status <= 599) metadata.httpStatus = status;
  if (Number.isSafeInteger(body?.error?.code)) metadata.graphCode = body.error.code;
  if (Number.isSafeInteger(body?.error?.error_subcode)) metadata.graphSubcode = body.error.error_subcode;
  return metadata;
}

export async function probeInstagram({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const readiness = readinessStatus(env);
  if (!readiness.configured) return failure(readiness, 'CONFIGURATION_REQUIRED', '서버 환경 변수의 누락 또는 형식을 확인해 주세요.');
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PROBE_TIMEOUT_MS) {
    return failure(readiness, 'PROBE_UNAVAILABLE', '읽기 전용 연결 검사를 시작할 수 없습니다.');
  }

  // No configurable origin, endpoint, recipient or HTTP method is accepted.
  const endpoint = new URL(`/${env.INSTAGRAM_API_VERSION}/${env.INSTAGRAM_ACCOUNT_ID}/subscribed_apps`, 'https://graph.instagram.com');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    response = await fetchImpl(endpoint.href, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` },
      redirect: 'error',
      signal: controller.signal,
    });
    body = await response.json();
  } catch {
    // Exceptions and Graph messages can contain URLs or credentials. Do not echo them.
    return failure(readiness, controller.signal.aborted ? 'PROBE_TIMEOUT' : 'PROBE_REQUEST_FAILED', controller.signal.aborted ? '읽기 전용 연결 검사 시간이 초과되었습니다.' : '읽기 전용 연결 요청 또는 JSON 응답을 확인하지 못했습니다.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok || body?.error) {
    return failure(readiness, 'GRAPH_REQUEST_REJECTED', 'Meta가 구독 정보 읽기 요청을 허용하지 않았습니다. 계정·토큰·권한과 API 버전을 확인해 주세요.', graphMetadata(body, response.status));
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.data) || body.data.length > 100 || body.data.some(app => !app || typeof app !== 'object' || Array.isArray(app) || !Array.isArray(app.subscribed_fields) || app.subscribed_fields.some(field => typeof field !== 'string'))) {
    return failure(readiness, 'UNEXPECTED_RESPONSE', '예상한 구독 정보 응답을 받지 못했습니다.');
  }
  const fields = [...new Set(body.data.flatMap(app => app.subscribed_fields).filter(field => OBSERVED_FIELDS.has(field)))].sort();
  return {
    ok: true,
    readiness,
    checks: noLiveChecks(true),
    subscriptions: { appCount: body.data.length, fields, hasComments: fields.includes('comments'), hasMessages: fields.includes('messages') },
    appIdentityVerified: false,
    liveSendingEnabled: false,
  };
}
