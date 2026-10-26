import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";

test("private app readiness APIs expose only variable names and require server-side configuration", async () => {
  let calls = 0;
  const app = createApp({
    dbPath: ":memory:",
    instagramEnv: {},
    instagramFetch: async () => {
      calls++;
      throw new Error("should not call");
    },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const status = await (await fetch(origin + "/api/instagram/status")).json();
    assert.equal(status.configured, false);
    assert.ok(status.missing.includes("INSTAGRAM_ACCESS_TOKEN"));
    const response = await fetch(origin + "/api/instagram/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 412);
    assert.equal((await response.json()).liveSendingEnabled, false);
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

test("read-only app probe rejects browser-supplied credentials and returns limited subscription evidence", async () => {
  const token = "fixture-private-token-not-a-real-credential";
  const env = {
    INSTAGRAM_LOGIN_MODE: "instagram",
    INSTAGRAM_API_VERSION: "v24.0",
    INSTAGRAM_ACCOUNT_ID: "12345",
    INSTAGRAM_ACCESS_TOKEN: token,
  };
  let calls = 0;
  const app = createApp({
    dbPath: ":memory:",
    instagramEnv: env,
    instagramFetch: async (url, options) => {
      calls++;
      assert.equal(options.method, "GET");
      assert.equal(new URL(url).hostname, "graph.instagram.com");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "redacted-app-id",
              subscribed_fields: ["comments", "messages"],
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const post = (body) =>
    fetch(origin + "/api/instagram/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await post({ INSTAGRAM_ACCESS_TOKEN: "browser-value" })).status,
      400,
    );
    assert.equal(calls, 0);
    const response = await post({});
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(!body.includes(token));
    assert.ok(!body.includes("redacted-app-id"));
    const result = JSON.parse(body);
    assert.equal(result.checks.subscriptionRead, true);
    assert.equal(result.checks.messaging, false);
    assert.equal(result.checks.followLookup, false);
    assert.equal(result.liveSendingEnabled, false);
    assert.equal(result.subscriptions.hasComments, true);
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});
