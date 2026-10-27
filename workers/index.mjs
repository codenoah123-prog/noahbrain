import { D1Store, ApiError } from "./store.mjs";
import {
  passwordConfigured,
  verifyPassword,
  createSession,
  readSession,
  clearSessionCookie,
  validMutation,
  encryptText,
  decryptText,
  webhookVerifyToken,
  verifyWebhook,
  sha256,
  equalBytes,
} from "./security.mjs";
import {
  GraphError,
  probeSubscriptions,
  subscribeInstagram,
  loadAccount,
  getMediaPosts,
  processInstagramEvent,
} from "./instagram.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}
function protectedHeaders(response) {
  const output = new Response(response.body, response);
  output.headers.set("X-Content-Type-Options", "nosniff");
  output.headers.set("X-Frame-Options", "DENY");
  output.headers.set("Referrer-Policy", "no-referrer");
  output.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  output.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  return output;
}
async function rawBody(request, limit = 65536) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, "BODY_TOO_LARGE", "입력 내용이 너무 큽니다.");
    }
    parts.push(value);
  }
  const raw = new Uint8Array(size);
  let position = 0;
  for (const value of parts) {
    raw.set(value, position);
    position += value.length;
  }
  return raw;
}
async function body(request) {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new ApiError(415, "CONTENT_TYPE", "JSON 입력이 필요합니다.");
  let input;
  try {
    input = JSON.parse(new TextDecoder().decode(await rawBody(request)));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "입력 내용을 확인해 주세요.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "INVALID_JSON", "입력 내용을 확인해 주세요.");
  return input;
}
async function connection(store, password) {
  const value = await store.getSetting("encrypted_connection");
  if (!value) return null;
  try {
    return JSON.parse(await decryptText(value, password));
  } catch {
    throw new ApiError(
      409,
      "CONNECTION_LOCKED",
      "저장한 연결 정보를 읽지 못했습니다. 관리자 비밀번호를 변경했다면 계정을 다시 연결해 주세요.",
    );
  }
}
async function setupStatus(store, password, origin) {
  let current;
  let reconnectRequired = false;
  try {
    current = await connection(store, password);
  } catch (error) {
    if (error instanceof ApiError && error.code === "CONNECTION_LOCKED") {
      current = null;
      reconnectRequired = true;
    } else throw error;
  }
  const subscription = await store.getSetting("subscription_proof");
  return {
    reconnectRequired,
    appId: current?.appId || "",
    apiVersion: current?.apiVersion || "v24.0",
    connected: !!current,
    hasCredentials: !!current,
    account: current
      ? { id: current.userId, username: current.username }
      : null,
    webhookVerified: !!(await store.getSetting("webhook_verified_at")),
    subscribed:
      !!current &&
      subscription?.userId === current.userId &&
      subscription?.appId === current.appId &&
      subscription?.appIdentityVerified === true &&
      subscription?.hasComments === true &&
      subscription?.hasMessages === true,
    enabled: !!current && (await store.getSetting("live_enabled")) === true,
    webhookUrl: origin + "/webhooks/instagram",
    verifyToken: await webhookVerifyToken(password),
    lastWebhookAt: await store.getSetting("last_webhook_at"),
    mode: current ? "live" : "demo",
    liveTestVerified: false,
  };
}
function credentialInput(input) {
  const { appId, appSecret, accountId, accessToken, apiVersion } = input;
  if (
    typeof appId !== "string" ||
    !/^\d{1,40}$/.test(appId) ||
    typeof accountId !== "string" ||
    !/^\d{1,40}$/.test(accountId)
  )
    throw new ApiError(
      400,
      "INVALID_IDS",
      "Meta 앱 ID와 Instagram 숫자 계정 ID를 확인해 주세요.",
    );
  if (
    typeof appSecret !== "string" ||
    appSecret.length < 16 ||
    appSecret.length > 512 ||
    /[\s\x00-\x1f]/.test(appSecret)
  )
    throw new ApiError(400, "INVALID_APP_SECRET", "앱 비밀값을 확인해 주세요.");
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    accessToken.length > 8192 ||
    /[\s\x00-\x1f]/.test(accessToken)
  )
    throw new ApiError(
      400,
      "INVALID_TOKEN",
      "계정의 액세스 토큰을 확인해 주세요.",
    );
  if (
    typeof apiVersion !== "string" ||
    !/^v[1-9]\d{0,2}\.\d{1,2}$/.test(apiVersion)
  )
    throw new ApiError(
      400,
      "INVALID_VERSION",
      "앱이 지원하는 API 버전을 확인해 주세요.",
    );
  return { appId, appSecret, userId: accountId, accessToken, apiVersion };
}
async function privateApi(request, env, store, session, fetchImpl) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method,
    password = env.ADMIN_PASSWORD;
  if (method !== "GET" && !validMutation(request, session))
    throw new ApiError(
      403,
      "CSRF_REJECTED",
      "이 사이트에서 다시 로그인한 뒤 시도해 주세요.",
    );
  if (method === "POST" && path === "/api/logout")
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  if (method === "GET" && path === "/api/setup")
    return json(await setupStatus(store, password, url.origin));
  if (method === "POST" && path === "/api/setup") {
    const credentials = credentialInput(await body(request));
    const account = await loadAccount({ ...credentials, fetchImpl });
    const subscription = await probeSubscriptions({
      ...credentials,
      fetchImpl,
    });
    const posts = await getMediaPosts({ ...credentials, fetchImpl });
    // Every reconnect requires deliberate activation and a new webhook verification.
    await store.setSetting("live_enabled", false);
    await store.run(
      "UPDATE pending_flows SET status='cancelled' WHERE status IN ('pending','processing')",
    );
    await store.setSetting(
      "encrypted_connection",
      await encryptText(
        JSON.stringify({ ...credentials, username: account.username }),
        password,
      ),
    );
    await store.deleteSetting("webhook_verified_at");
    await store.setSetting("subscription_proof", {
      ...subscription,
      userId: credentials.userId,
      appId: credentials.appId,
    });
    await store.replacePosts(posts);
    return json({
      ok: true,
      setup: await setupStatus(store, password, url.origin),
    });
  }
  if (method === "POST" && path === "/api/setup/disconnect") {
    await body(request);
    await store.setSetting("live_enabled", false);
    await store.deleteSetting("encrypted_connection");
    await store.deleteSetting("subscription_proof");
    await store.deleteSetting("webhook_verified_at");
    return json({
      ok: true,
      setup: await setupStatus(store, password, url.origin),
    });
  }
  if (method === "POST" && path === "/api/setup/subscribe") {
    await body(request);
    const current = await connection(store, password);
    if (!current)
      throw new ApiError(409, "NOT_CONNECTED", "먼저 계정을 연결해 주세요.");
    const proof = await subscribeInstagram({ ...current, fetchImpl });
    await store.setSetting("subscription_proof", {
      ...proof,
      userId: current.userId,
      appId: current.appId,
    });
    return json({
      ok: true,
      fields: proof.fields,
      setup: await setupStatus(store, password, url.origin),
    });
  }
  if (method === "POST" && path === "/api/setup/enable") {
    const input = await body(request);
    if (typeof input.enabled !== "boolean")
      throw new ApiError(400, "INVALID_STATUS", "발송 상태를 확인해 주세요.");
    if (input.enabled) {
      const status = await setupStatus(store, password, url.origin);
      if (
        input.acknowledged !== true ||
        !status.connected ||
        !status.webhookVerified ||
        !status.subscribed
      )
        throw new ApiError(
          409,
          "SETUP_REQUIRED",
          "계정 연결, 웹훅 검증, 댓글·메시지 구독과 실발송 동의가 필요합니다.",
        );
    }
    await store.setSetting("live_enabled", input.enabled);
    return json({ enabled: input.enabled });
  }
  if (method === "POST" && path === "/api/posts/sync") {
    await body(request);
    const current = await connection(store, password);
    if (!current)
      throw new ApiError(409, "NOT_CONNECTED", "먼저 계정을 연결해 주세요.");
    await store.replacePosts(await getMediaPosts({ ...current, fetchImpl }));
    return json({ posts: await store.posts() });
  }
  if (method === "GET" && path === "/api/instagram/status") {
    const current = await connection(store, password);
    return json({
      configured: !!current,
      status: current
        ? "credentials_present_unverified"
        : "configuration_required",
      missing: current ? [] : ["사이트의 계정 설정에서 연결해 주세요"],
      invalid: [],
      liveSendingEnabled: false,
    });
  }
  if (method === "POST" && path === "/api/instagram/probe") {
    await body(request);
    const current = await connection(store, password);
    if (!current)
      throw new ApiError(409, "NOT_CONNECTED", "먼저 계정을 연결해 주세요.");
    const proof = await probeSubscriptions({ ...current, fetchImpl });
    return json({
      ok: true,
      subscriptions: proof,
      liveSendingEnabled: false,
      checks: { subscriptionRead: true, messaging: false, followLookup: false },
    });
  }
  const current = await connection(store, password);
  if (!current) await store.seedDemoOnce();
  if (method === "GET" && path === "/api/health")
    return json({
      ok: true,
      mode: current ? "live" : "demo",
      liveConnected: !!current,
      liveSendingEnabled: (await store.getSetting("live_enabled")) === true,
    });
  if (method === "GET" && path === "/api/posts")
    return json({ posts: await store.posts() });
  if (method === "GET" && path === "/api/overview")
    return json(await store.overview());
  if (method === "GET" && path === "/api/automations")
    return json({ automations: await store.automations() });
  if (method === "POST" && path === "/api/automations")
    return json({ automation: await store.create(await body(request)) }, 201);
  if (method === "GET" && path === "/api/deliveries")
    return json({ deliveries: await store.deliveries() });
  if (method === "POST" && path === "/api/simulate")
    return json(await store.simulate(await body(request)));
  let match = path.match(/^\/api\/automations\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (method === "PATCH")
      return json({ automation: await store.update(id, await body(request)) });
    if (method === "DELETE") {
      await store.delete(id);
      return json({ ok: true });
    }
    if (method === "GET")
      return json({ automation: await store.automation(id) });
  }
  match = path.match(/^\/api\/deliveries\/([^/]+)\/verify-follow$/);
  if (match && method === "POST")
    return json(
      await store.verifyFollow(
        decodeURIComponent(match[1]),
        await body(request),
      ),
    );
  throw new ApiError(404, "NOT_FOUND", "요청한 기능을 찾지 못했습니다.");
}
async function webhook(request, env, store, ctx, fetchImpl) {
  const url = new URL(request.url),
    password = env.ADMIN_PASSWORD;
  if (request.method === "GET") {
    const expected = await webhookVerifyToken(password),
      given = url.searchParams.get("hub.verify_token") || "";
    if (
      url.searchParams.get("hub.mode") !== "subscribe" ||
      !equalBytes(
        new TextEncoder().encode(given),
        new TextEncoder().encode(expected),
      )
    )
      throw new ApiError(
        403,
        "WEBHOOK_VERIFY_REJECTED",
        "검증 정보가 맞지 않습니다.",
      );
    const challenge = url.searchParams.get("hub.challenge");
    if (!challenge || challenge.length > 2000)
      throw new ApiError(
        400,
        "INVALID_CHALLENGE",
        "검증 내용을 확인해 주세요.",
      );
    await store.setSetting("webhook_verified_at", new Date().toISOString());
    return new Response(challenge, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  if (request.method !== "POST")
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "지원하지 않는 요청입니다.");
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new ApiError(415, "CONTENT_TYPE", "JSON 요청이 필요합니다.");
  const raw = await rawBody(request, 256 * 1024);
  const current = await connection(store, password);
  if (!current)
    throw new ApiError(503, "NOT_CONFIGURED", "계정 연결이 필요합니다.");
  if (
    !(await verifyWebhook(
      raw,
      request.headers.get("X-Hub-Signature-256"),
      current.appSecret,
    ))
  )
    throw new ApiError(
      403,
      "SIGNATURE_REJECTED",
      "서명을 확인하지 못했습니다.",
    );
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "이벤트 형식을 확인해 주세요.");
  }
  if (
    payload?.object !== "instagram" ||
    !Array.isArray(payload.entry) ||
    payload.entry.length > 100
  )
    throw new ApiError(
      400,
      "INVALID_EVENT",
      "Instagram 이벤트 형식이 아닙니다.",
    );
  await store.setSetting("last_webhook_at", new Date().toISOString());
  const enabled = (await store.getSetting("live_enabled")) === true;
  if (enabled) {
    const task = processInstagramEvent({
      payload,
      store,
      connection: { ...current, liveEnabled: true },
      fetchImpl,
    }).catch(async () => {
      await store.setSetting("last_processing_error", "PROCESSING_FAILED");
    });
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;
  }
  return json({ received: true, liveSendingEnabled: enabled });
}
export async function handleRequest(
  request,
  env,
  ctx = {},
  fetchImpl = globalThis.fetch,
) {
  try {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/api/session" && request.method === "GET") {
      const session = await readSession(request, env.ADMIN_PASSWORD);
      return protectedHeaders(
        json({
          configured: passwordConfigured(env.ADMIN_PASSWORD) && !!env.DB,
          authenticated: !!session,
          csrf: session?.csrf || null,
        }),
      );
    }
    if (path.startsWith("/api/") || path === "/webhooks/instagram") {
      if (!passwordConfigured(env.ADMIN_PASSWORD) || !env.DB)
        throw new ApiError(
          503,
          "DEPLOYMENT_REQUIRED",
          "Cloudflare에서 DB와 20자 이상의 충분히 복잡한 ADMIN_PASSWORD 비밀 설정을 완료해 주세요.",
        );
      const store = new D1Store(env.DB);
      if (path === "/api/login" && request.method === "POST") {
        if (request.headers.get("Origin") !== url.origin)
          throw new ApiError(
            403,
            "ORIGIN_REJECTED",
            "사이트에서 로그인해 주세요.",
          );
        const input = await body(request);
        await store.init();
        const bucket = Math.floor(Date.now() / 600000),
          key = await sha256(
            (request.headers.get("CF-Connecting-IP") || "unknown") +
              ":" +
              bucket,
          );
        if (!(await store.consumeLoginAttempt(key)))
          throw new ApiError(
            429,
            "LOGIN_LIMIT",
            "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.",
          );
        if (!(await verifyPassword(input.password, env.ADMIN_PASSWORD)))
          throw new ApiError(
            401,
            "LOGIN_FAILED",
            "관리자 비밀번호를 확인해 주세요.",
          );
        const session = await createSession(env.ADMIN_PASSWORD);
        return protectedHeaders(
          json({ ok: true, csrf: session.csrf }, 200, {
            "Set-Cookie": session.cookie,
          }),
        );
      }
      if (path === "/webhooks/instagram") {
        await store.init();
        return protectedHeaders(
          await webhook(request, env, store, ctx, fetchImpl),
        );
      }
      const session = await readSession(request, env.ADMIN_PASSWORD);
      if (!session)
        throw new ApiError(401, "AUTH_REQUIRED", "사이트에 로그인해 주세요.");
      await store.init();
      return protectedHeaders(
        await privateApi(request, env, store, session, fetchImpl),
      );
    }
    if (path.startsWith("/auth/"))
      throw new ApiError(
        404,
        "NOT_FOUND",
        "이 버전은 로그인한 관리자 화면에서 Meta 연결값을 등록합니다.",
      );
    return protectedHeaders(
      env.ASSETS
        ? await env.ASSETS.fetch(request)
        : new Response("noahflow", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
    );
  } catch (error) {
    const known = error instanceof ApiError || error instanceof GraphError;
    return protectedHeaders(
      json(
        {
          error: {
            code: known ? error.code : "INTERNAL_ERROR",
            message: known
              ? error.message
              : "요청을 완료하지 못했습니다. 다시 시도해 주세요.",
            ...(error instanceof GraphError &&
            Number.isSafeInteger(error.graphCode)
              ? { graphCode: error.graphCode }
              : {}),
          },
        },
        error instanceof ApiError
          ? error.status
          : error instanceof GraphError
            ? 502
            : 500,
      ),
    );
  }
}
export default { fetch: handleRequest };
