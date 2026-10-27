import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { handleRequest } from "../workers/index.mjs";

const PASSWORD = "Fixture-admin-only-strong-password-2026!";
const APP_SECRET = "fixture-meta-app-secret-0123456789";
const TOKEN = "fixture-instagram-access-token-not-real";
async function harness() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("fixture")}}',
    compatibilityDate: "2026-07-01",
    d1Databases: ["DB"],
  });
  const db = await mf.getD1Database("DB");
  const env = { DB: db, ADMIN_PASSWORD: PASSWORD };
  const calls = [];
  const upstream = async (url, options = {}) => {
    const target = new URL(url);
    assert.equal(target.hostname, "graph.instagram.com");
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    const message = options.body ? JSON.parse(options.body) : null;
    calls.push({
      path: target.pathname,
      method: options.method,
      body: message,
    });
    let data;
    if (target.pathname === "/v24.0/1001")
      data = { id: "1001", username: "my_creator" };
    else if (target.pathname === "/v24.0/1001/subscribed_apps")
      data =
        options.method === "POST"
          ? { success: true }
          : {
              data: [
                { id: "2001", subscribed_fields: ["comments", "messages"] },
              ],
            };
    else if (target.pathname === "/v24.0/1001/media")
      data = {
        data: [
          {
            id: "9001",
            caption: "정보가 필요한 분께",
            media_type: "IMAGE",
            media_product_type: "FEED",
            media_url: "https://example.com/post.jpg",
            timestamp: new Date().toISOString(),
            comments_count: 0,
          },
        ],
      };
    else if (target.pathname === "/v24.0/1001/messages")
      data = {
        recipient_id: "3001",
        message_id: message?.recipient?.comment_id
          ? "first-message"
          : "followup-message",
      };
    else if (target.pathname === "/v24.0/3001")
      data = { is_user_follow_business: true };
    else throw new Error("Unexpected upstream path");
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  };
  let cookie = "",
    csrf = "";
  async function request(
    path,
    { method = "GET", body, headers = {}, anonymous = false } = {},
  ) {
    const init = {
      method,
      headers: {
        ...(anonymous ? {} : { Cookie: cookie, "X-CSRF-Token": csrf }),
        ...(method === "GET"
          ? {}
          : {
              Origin: "https://noahflow.test",
              "Content-Type": "application/json",
            }),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return handleRequest(
      new Request("https://noahflow.test" + path, init),
      env,
      {},
      upstream,
    );
  }
  async function login(password = PASSWORD) {
    const response = await request("/api/login", {
      method: "POST",
      body: { password },
    });
    assert.equal(response.status, 200);
    cookie = response.headers.get("Set-Cookie").split(";")[0];
    const result = await response.json();
    csrf = result.csrf;
    return { cookie, csrf };
  }
  async function connect() {
    const response = await request("/api/setup", {
      method: "POST",
      body: {
        appId: "2001",
        appSecret: APP_SECRET,
        accountId: "1001",
        accessToken: TOKEN,
        apiVersion: "v24.0",
      },
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).setup;
  }
  return { mf, db, env, calls, request, login, connect };
}

test("hosted app is private by default and enforces origin, CSRF and secure session cookies", async () => {
  const h = await harness();
  try {
    assert.equal((await h.request("/api/automations")).status, 401);
    assert.equal(
      (
        await h.request("/api/login", {
          method: "POST",
          body: { password: PASSWORD },
          headers: { Origin: "https://attacker.test" },
        })
      ).status,
      403,
    );
    const session = await h.login();
    assert.ok(session.cookie.startsWith("__Host-noahflow="));
    const status = await (await h.request("/api/session")).json();
    assert.equal(status.authenticated, true);
    assert.equal(
      (
        await h.request("/api/automations", {
          method: "POST",
          body: {},
          headers: { "X-CSRF-Token": "wrong" },
        })
      ).status,
      403,
    );
    const posts = await (await h.request("/api/posts")).json();
    assert.equal(posts.posts.length, 6);
    const logout = await h.request("/api/logout", { method: "POST", body: {} });
    assert.equal(logout.status, 200);
    assert.match(
      logout.headers.get("Set-Cookie"),
      /HttpOnly.*Secure.*SameSite=Lax.*Max-Age=0/,
    );
  } finally {
    await h.mf.dispose();
  }
});

test("missing or weak administrator password never creates an open setup account", async () => {
  const h = await harness();
  try {
    for (const password of ["", "short", "a".repeat(30)]) {
      const env = { ...h.env, ADMIN_PASSWORD: password };
      const response = await handleRequest(
        new Request("https://noahflow.test/api/session"),
        env,
      );
      assert.equal((await response.json()).configured, false);
      const protectedResponse = await handleRequest(
        new Request("https://noahflow.test/api/setup"),
        env,
      );
      assert.equal(protectedResponse.status, 503);
    }
  } finally {
    await h.mf.dispose();
  }
});

test("real connection credentials are encrypted in D1 and never returned to the browser", async () => {
  const h = await harness();
  try {
    await h.login();
    const setup = await h.connect();
    assert.equal(setup.connected, true);
    assert.equal(setup.account.username, "my_creator");
    assert.equal(setup.enabled, false);
    const serialized = JSON.stringify(setup);
    assert.ok(!serialized.includes(TOKEN));
    assert.ok(!serialized.includes(APP_SECRET));
    const raw = await h.db
      .prepare("SELECT value FROM metadata WHERE key='encrypted_connection'")
      .first();
    assert.ok(!raw.value.includes(TOKEN));
    assert.ok(!raw.value.includes(APP_SECRET));
    assert.match(JSON.parse(raw.value), /^v1\./);
    const posts = await (await h.request("/api/posts")).json();
    assert.deepEqual(
      posts.posts.map((post) => post.id),
      ["9001"],
    );
    const notReady = await h.request("/api/setup/enable", {
      method: "POST",
      body: { enabled: true, acknowledged: true },
    });
    assert.equal(notReady.status, 409);
    assert.equal(
      h.calls.filter((call) => call.method === "POST").length,
      0,
      "connection alone must not send or subscribe",
    );
  } finally {
    await h.mf.dispose();
  }
});

test("signed comment and actual confirmation reply deliver once only after explicit activation", async () => {
  const h = await harness();
  try {
    await h.login();
    let setup = await h.connect();
    const rule = {
      name: "정보 자동화",
      postId: "9001",
      triggerType: "keywords",
      keywords: ["정보"],
      requireFollow: true,
      replyEnabled: false,
      replyText: "",
      nonFollowerMessage: "팔로우 후 이 DM에 확인이라고 답장해 주세요.",
      message: {
        text: "요청하신 자료입니다.",
        imageUrl: "",
        links: [{ label: "자료 받기", url: "https://example.com/info" }],
      },
      status: "active",
    };
    assert.equal(
      (await h.request("/api/automations", { method: "POST", body: rule }))
        .status,
      201,
    );
    assert.equal(
      (
        await h.request(
          "/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123",
          { anonymous: true },
        )
      ).status,
      403,
    );
    const challenge = await h.request(
      "/webhooks/instagram?hub.mode=subscribe&hub.verify_token=" +
        encodeURIComponent(setup.verifyToken) +
        "&hub.challenge=123",
      { anonymous: true },
    );
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), "123");
    assert.equal(
      (await h.request("/api/setup/subscribe", { method: "POST", body: {} }))
        .status,
      200,
    );
    assert.equal(
      (
        await h.request("/api/setup/enable", {
          method: "POST",
          body: { enabled: true },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.request("/api/setup/enable", {
          method: "POST",
          body: { enabled: true, acknowledged: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request("/api/simulate", {
          method: "POST",
          body: {
            automationId: (await (await h.request("/api/automations")).json())
              .automations[0].id,
            username: "demo_only",
            comment: "정보",
            isFollower: true,
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await h.request("/api/automations")).json()).automations[0].counts
        .sent,
      0,
      "demo results must not inflate actual card counts",
    );
    async function webhook(payload, signature = true) {
      const raw = JSON.stringify(payload);
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(APP_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const digest = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
      );
      const hex = Array.from(digest, (x) =>
        x.toString(16).padStart(2, "0"),
      ).join("");
      return handleRequest(
        new Request("https://noahflow.test/webhooks/instagram", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Hub-Signature-256": signature
              ? "sha256=" + hex
              : "sha256=" + "0".repeat(64),
          },
          body: raw,
        }),
        h.env,
        {},
        async (url, options) => {
          // Keep the mock inside this harness; never make a real Meta request.
          const target = new URL(url);
          h.calls.push({
            path: target.pathname,
            method: options.method,
            body: options.body ? JSON.parse(options.body) : null,
          });
          if (target.pathname === "/v24.0/3001")
            return Response.json({ is_user_follow_business: true });
          if (target.pathname === "/v24.0/1001/messages")
            return Response.json({
              recipient_id: "3001",
              message_id: "message-" + h.calls.length,
            });
          throw new Error("Unexpected live request");
        },
      );
    }
    const comment = {
      object: "instagram",
      entry: [
        {
          id: "1001",
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: "comments",
              value: {
                id: "4001",
                media: { id: "9001" },
                from: { id: "3001", username: "requester" },
                text: "정보 주세요",
              },
            },
          ],
        },
      ],
    };
    assert.equal((await webhook(comment, false)).status, 403);
    assert.equal((await webhook(comment)).status, 200);
    assert.equal((await webhook(comment)).status, 200);
    assert.equal(
      h.calls.filter((call) => call.body?.recipient?.comment_id).length,
      1,
    );
    assert.equal(
      h.calls.filter((call) => call.path === "/v24.0/3001").length,
      0,
      "comment alone must not query follower state",
    );
    const reply = {
      object: "instagram",
      entry: [
        {
          id: "1001",
          messaging: [
            {
              sender: { id: "3001" },
              recipient: { id: "1001" },
              timestamp: Date.now(),
              message: { mid: "confirmation-mid-1", text: "확인" },
            },
          ],
        },
      ],
    };
    assert.equal((await webhook(reply)).status, 200);
    assert.equal((await webhook(reply)).status, 200);
    assert.equal(
      h.calls.filter((call) => call.path === "/v24.0/3001").length,
      1,
    );
    assert.equal(
      h.calls.filter((call) => call.body?.recipient?.id === "3001").length,
      2,
      "one text and one link template only",
    );
    const overview = await (await h.request("/api/overview")).json();
    assert.equal(overview.stats.pending, 0);
    assert.equal(overview.stats.sent, 1);
    const cards = await (await h.request("/api/automations")).json();
    assert.equal(cards.automations[0].counts.pending, 0);
    assert.equal(cards.automations[0].counts.sent, 1);
    const logs = await (await h.request("/api/deliveries")).json();
    assert.ok(
      logs.deliveries.some(
        (delivery) => delivery.mode === "live" && delivery.status === "sent",
      ),
    );
  } finally {
    await h.mf.dispose();
  }
});

test("login attempt limits reject repeated guessing without exposing configuration", async () => {
  const h = await harness();
  try {
    for (let attempt = 0; attempt < 10; attempt++)
      assert.equal(
        (
          await h.request("/api/login", {
            method: "POST",
            body: { password: "wrong" },
          })
        ).status,
        401,
      );
    const limited = await h.request("/api/login", {
      method: "POST",
      body: { password: "wrong" },
    });
    assert.equal(limited.status, 429);
    assert.ok(!(await limited.text()).includes(PASSWORD));
  } finally {
    await h.mf.dispose();
  }
});

test("password rotation presents a recoverable reconnect form without exposing or deleting old ciphertext", async () => {
  const h = await harness();
  try {
    await h.login();
    await h.connect();
    const before = await h.db
      .prepare("SELECT value FROM metadata WHERE key='encrypted_connection'")
      .first();
    h.env.ADMIN_PASSWORD = "New-distinct-admin-password-fixture-2026!";
    await h.login(h.env.ADMIN_PASSWORD);
    const response = await h.request("/api/setup");
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.connected, false);
    assert.equal(status.reconnectRequired, true);
    const after = await h.db
      .prepare("SELECT value FROM metadata WHERE key='encrypted_connection'")
      .first();
    assert.equal(after.value, before.value);
    assert.ok(!JSON.stringify(status).includes(TOKEN));
    await h.connect();
    assert.equal(
      (await (await h.request("/api/setup")).json()).connected,
      true,
    );
  } finally {
    await h.mf.dispose();
  }
});
