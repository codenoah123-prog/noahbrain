import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.mjs";

let app;
let origin;

before(async () => {
  app = createApp({ dbPath: ":memory:" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await app.close();
});

async function request(path, options = {}) {
  const response = await fetch(origin + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    ...(options.body === undefined
      ? {}
      : {
          body:
            typeof options.body === "string"
              ? options.body
              : JSON.stringify(options.body),
        }),
  });
  return { status: response.status, body: await response.json() };
}

function rule(overrides = {}) {
  return {
    name: "테스트 자료 보내기",
    postId: "post-1",
    triggerType: "keywords",
    keywords: ["가이드", "GUIDE"],
    requireFollow: false,
    replyEnabled: true,
    replyText: "DM을 확인해 주세요.",
    message: {
      text: "요청하신 자료입니다.",
      imageUrl: "https://example.com/guide.jpg",
      links: [{ label: "자료 보기", url: "https://example.com/guide" }],
    },
    nonFollowerMessage: "팔로우 후 확인해 주세요.",
    status: "active",
    ...overrides,
  };
}

async function createRule(overrides = {}) {
  const result = await request("/api/automations", {
    method: "POST",
    body: rule(overrides),
  });
  assert.equal(result.status, 201);
  return result.body.automation;
}

test("health explicitly reports demo mode and no live connection", async () => {
  const result = await request("/api/health");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    mode: "demo",
    liveConnected: false,
  });
});

test("six demo posts and two initial automations load without fabricated deliveries", async () => {
  const posts = await request("/api/posts");
  assert.equal(posts.body.posts.length, 6);
  assert.ok(posts.body.posts.some((post) => post.kind === "REEL"));
  const overview = await request("/api/overview");
  assert.equal(overview.body.stats.sent, 0);
  assert.equal(overview.body.stats.pending, 0);
  assert.equal(overview.body.recentDeliveries.length, 0);
  assert.equal(overview.body.activity.length, 7);
});

test("automation CRUD persists its message, statuses, timestamps and post relation", async () => {
  const created = await createRule();
  assert.equal(created.post.id, "post-1");
  assert.deepEqual(created.counts, { sent: 0, pending: 0, skipped: 0 });
  assert.equal(created.message.imageUrl, "https://example.com/guide.jpg");
  const updated = await request(`/api/automations/${created.id}`, {
    method: "PATCH",
    body: { status: "paused", name: "변경된 자동화" },
  });
  assert.equal(updated.body.automation.status, "paused");
  assert.equal(updated.body.automation.name, "변경된 자동화");
  assert.equal(updated.body.automation.createdAt, created.createdAt);
  assert.deepEqual(updated.body.automation.message, created.message);
  assert.equal(
    (await request(`/api/automations/${created.id}`, { method: "DELETE" }))
      .status,
    200,
  );
  assert.equal((await request(`/api/automations/${created.id}`)).status, 404);
});

test("keyword OR matching ignores case and Unicode width differences", async () => {
  const automation = await createRule();
  const result = await request("/api/simulate", {
    method: "POST",
    body: {
      automationId: automation.id,
      username: "@creator",
      comment: "ＧＵＩＤＥ 보내 주세요!",
      isFollower: false,
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.delivery.status, "sent");
  assert.equal(result.body.delivery.mode, "demo");
  assert.equal(result.body.delivery.username, "creator");
  assert.equal(result.body.delivery.reply, "DM을 확인해 주세요.");
  assert.deepEqual(result.body.delivery.message, automation.message);
});

test("nonmatching keywords, paused rules, and a different post cannot produce sent messages", async () => {
  const automation = await createRule();
  const common = {
    automationId: automation.id,
    username: "reader",
    isFollower: true,
  };
  const noKeyword = await request("/api/simulate", {
    method: "POST",
    body: { ...common, comment: "반갑습니다" },
  });
  assert.equal(noKeyword.body.delivery.status, "skipped");
  assert.equal(noKeyword.body.delivery.message, null);
  const wrongPost = await request("/api/simulate", {
    method: "POST",
    body: { ...common, comment: "가이드", postId: "post-2" },
  });
  assert.equal(wrongPost.body.delivery.status, "skipped");
  assert.equal(wrongPost.body.delivery.reason, "대상 게시물 불일치");
  await request(`/api/automations/${automation.id}`, {
    method: "PATCH",
    body: { status: "paused" },
  });
  const paused = await request("/api/simulate", {
    method: "POST",
    body: { ...common, comment: "자료 가이드" },
  });
  assert.equal(paused.body.delivery.status, "skipped");
  assert.equal(paused.body.delivery.reason, "일시정지된 자동화");
});

test("all-comments mode works without keywords and optional public reply", async () => {
  const automation = await createRule({
    triggerType: "all",
    keywords: [],
    replyEnabled: false,
    replyText: "",
  });
  const result = await request("/api/simulate", {
    method: "POST",
    body: {
      automationId: automation.id,
      username: "friend",
      comment: "안녕하세요!",
      isFollower: false,
    },
  });
  assert.equal(result.body.delivery.status, "sent");
  assert.equal(result.body.delivery.reply, null);
});

test("username templates personalize recipient snapshots without changing saved templates", async () => {
  const automation = await createRule({
    requireFollow: true,
    replyText: "{{username}}님, DM을 확인해 주세요.",
    nonFollowerMessage: "{{ username }}님, 팔로우해 주세요.",
    message: {
      text: "{{username}}님을 위한 자료예요.",
      imageUrl: "",
      links: [
        { label: "{{username}}님의 자료", url: "https://example.com/guide" },
      ],
    },
  });
  const username = "a".repeat(30);
  const result = await request("/api/simulate", {
    method: "POST",
    body: {
      automationId: automation.id,
      username: "@" + username,
      comment: "가이드",
      isFollower: false,
    },
  });
  assert.equal(result.status, 200);
  assert.equal(
    result.body.delivery.message.text,
    username + "님을 위한 자료예요.",
  );
  assert.equal(
    result.body.delivery.message.links[0].label,
    username + "님의 자료",
  );
  assert.equal(
    result.body.delivery.reply,
    username + "님, DM을 확인해 주세요.",
  );
  assert.equal(
    result.body.delivery.nonFollowerMessage,
    username + "님, 팔로우해 주세요.",
  );
  const stored = await request(`/api/automations/${automation.id}`);
  assert.equal(
    stored.body.automation.message.text,
    "{{username}}님을 위한 자료예요.",
  );
});

test("follow gate stays pending until confirmation, then sends exactly once using original content", async () => {
  const automation = await createRule({ requireFollow: true });
  const result = await request("/api/simulate", {
    method: "POST",
    body: {
      automationId: automation.id,
      username: "newfriend",
      comment: "가이드",
      isFollower: false,
    },
  });
  assert.equal(result.body.delivery.status, "pending_follow");
  assert.equal(
    result.body.delivery.nonFollowerMessage,
    automation.nonFollowerMessage,
  );
  const id = result.body.delivery.id;
  const stillPending = await request(`/api/deliveries/${id}/verify-follow`, {
    method: "POST",
    body: { isFollower: false },
  });
  assert.equal(stillPending.body.delivery.status, "pending_follow");
  await request(`/api/automations/${automation.id}`, {
    method: "PATCH",
    body: { message: { text: "수정된 메시지" } },
  });
  const confirmed = await request(`/api/deliveries/${id}/verify-follow`, {
    method: "POST",
    body: { isFollower: true },
  });
  assert.equal(confirmed.body.delivery.status, "sent");
  assert.equal(confirmed.body.delivery.isFollower, true);
  assert.equal(confirmed.body.delivery.message.text, "요청하신 자료입니다.");
  const duplicate = await request(`/api/deliveries/${id}/verify-follow`, {
    method: "POST",
    body: { isFollower: true },
  });
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.delivery.id, id);
});

test("pausing or deleting an automation blocks its pending follow confirmations", async () => {
  const automation = await createRule({ requireFollow: true });
  const pending = await request("/api/simulate", {
    method: "POST",
    body: {
      automationId: automation.id,
      username: "pausedfriend",
      comment: "가이드",
      isFollower: false,
    },
  });
  await request(`/api/automations/${automation.id}`, {
    method: "PATCH",
    body: { status: "paused" },
  });
  const paused = await request(
    `/api/deliveries/${pending.body.delivery.id}/verify-follow`,
    { method: "POST", body: { isFollower: true } },
  );
  assert.equal(paused.status, 409);
  assert.equal(paused.body.error.code, "AUTOMATION_PAUSED");
  await request(`/api/automations/${automation.id}`, { method: "DELETE" });
  const deleted = await request(
    `/api/deliveries/${pending.body.delivery.id}/verify-follow`,
    { method: "POST", body: { isFollower: true } },
  );
  assert.equal(deleted.status, 409);
  assert.equal(deleted.body.error.code, "AUTOMATION_UNAVAILABLE");
});

test("duplicate comment events reuse one record; different event IDs represent distinct comments", async () => {
  const automation = await createRule();
  const event = {
    automationId: automation.id,
    username: "repeatreader",
    comment: "가이드",
    isFollower: true,
    eventId: "ig-comment-1",
  };
  const first = await request("/api/simulate", { method: "POST", body: event });
  const second = await request("/api/simulate", {
    method: "POST",
    body: event,
  });
  assert.equal(first.body.duplicate, false);
  assert.equal(second.body.duplicate, true);
  assert.equal(first.body.delivery.id, second.body.delivery.id);
  const third = await request("/api/simulate", {
    method: "POST",
    body: { ...event, eventId: "ig-comment-2" },
  });
  assert.equal(third.body.duplicate, false);
  assert.notEqual(third.body.delivery.id, first.body.delivery.id);
  const stored = await request(`/api/automations/${automation.id}`);
  assert.equal(stored.body.automation.counts.sent, 2);
});

test("deduplication without explicit event ID also prevents accidental repeated sends", async () => {
  const automation = await createRule();
  const event = {
    automationId: automation.id,
    username: "repeat",
    comment: "가이드 주세요",
    isFollower: true,
  };
  const first = await request("/api/simulate", { method: "POST", body: event });
  const repeated = await request("/api/simulate", {
    method: "POST",
    body: event,
  });
  assert.equal(repeated.body.duplicate, true);
  assert.equal(first.body.delivery.id, repeated.body.delivery.id);
});

test("invalid and unsafe automation inputs are rejected with structured field errors", async () => {
  for (const [overrides, field] of [
    [{ keywords: [] }, "keywords"],
    [{ status: "unexpected" }, "status"],
    [{ postId: "missing" }, "postId"],
    [{ requireFollow: "yes" }, "requireFollow"],
    [{ message: { text: "", imageUrl: "", links: [] } }, "message"],
    [
      { message: { text: "안녕", imageUrl: "javascript:alert(1)", links: [] } },
      "message.imageUrl",
    ],
    [
      {
        message: {
          text: "안녕",
          imageUrl: "",
          links: [
            { label: "링크", url: "https://secret:password@example.com/" },
          ],
        },
      },
      "message.links.url",
    ],
    [{ replyEnabled: true, replyText: "" }, "replyText"],
  ]) {
    const result = await request("/api/automations", {
      method: "POST",
      body: rule(overrides),
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "VALIDATION_ERROR");
    assert.ok(result.body.error.fields.includes(field));
  }
});

test("malformed JSON, unsupported content type, invalid event input and unknown paths fail clearly", async () => {
  assert.equal(
    (await request("/api/automations", { method: "POST", body: "{bad" }))
      .status,
    400,
  );
  assert.equal(
    (
      await request("/api/automations", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal((await request("/api/not-a-route")).status, 404);
  const invalid = await request("/api/simulate", {
    method: "POST",
    body: {
      automationId: "automation-guide",
      username: "bad username",
      comment: "가이드",
      isFollower: true,
    },
  });
  assert.equal(invalid.status, 400);
  const missingBoolean = await request("/api/simulate", {
    method: "POST",
    body: {
      automationId: "automation-guide",
      username: "goodname",
      comment: "가이드",
    },
  });
  assert.equal(missingBoolean.status, 400);
});

test("oversized JSON and malformed message updates are rejected without mutating automation", async () => {
  const tooLarge = await request("/api/automations", {
    method: "POST",
    body: { name: "a".repeat(70000) },
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error.code, "BODY_TOO_LARGE");
  const automation = await createRule();
  for (const message of [null, 42, []]) {
    const malformed = await request(`/api/automations/${automation.id}`, {
      method: "PATCH",
      body: { message },
    });
    assert.equal(malformed.status, 400);
  }
  const unchanged = await request(`/api/automations/${automation.id}`);
  assert.deepEqual(unchanged.body.automation.message, automation.message);
});

test("SQLite data survives reopen and seed data does not reappear after deletion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "noahbrain-db-"));
  const dbPath = join(directory, "test.sqlite");
  let first;
  let second;
  try {
    first = createApp({ dbPath });
    const created = first.store.create(rule({ name: "유지되는 자동화" }));
    first.store.delete("automation-guide");
    first.store.simulate({
      automationId: created.id,
      username: "persistent",
      comment: "가이드",
      isFollower: true,
    });
    first.store.close();
    first = null;
    second = createApp({ dbPath });
    assert.equal(second.store.automation(created.id).name, "유지되는 자동화");
    assert.equal(second.store.deliveries().length, 1);
    assert.equal(second.store.rawAutomation("automation-guide"), null);
  } finally {
    first?.store.close();
    second?.store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production static serving returns assets and SPA routes while isolating API and filesystem paths", async () => {
  const directory = mkdtempSync(join(tmpdir(), "noahbrain-static-"));
  const staticDir = join(directory, "dist");
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(
    join(staticDir, "index.html"),
    "<!doctype html><title>Noahbrain fixture</title>",
  );
  writeFileSync(join(staticDir, "assets", "app.js"), 'console.log("fixture");');
  writeFileSync(join(directory, "secret.txt"), "NEVER-SERVE-THIS");
  symlinkSync(
    join(directory, "secret.txt"),
    join(staticDir, "assets", "escaped.txt"),
  );
  const production = createApp({ dbPath: ":memory:", staticDir });
  await new Promise((resolve) =>
    production.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${production.server.address().port}`;
  try {
    const index = await fetch(base + "/");
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type"), /text\/html/);
    assert.match(await index.text(), /Noahbrain fixture/);
    const route = await fetch(base + "/automations/new");
    assert.equal(route.status, 200);
    assert.match(await route.text(), /Noahbrain fixture/);
    const script = await fetch(base + "/assets/app.js");
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /text\/javascript/);
    assert.equal(await script.text(), 'console.log("fixture");');
    const head = await fetch(base + "/assets/app.js", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    for (const path of [
      "/api/missing",
      "/assets/missing.js",
      "/assets/escaped.txt",
      "/..%2fsecret.txt",
      "/.env",
    ]) {
      const blocked = await fetch(base + path);
      assert.equal(blocked.status, 404, path);
      assert.doesNotMatch(
        await blocked.text(),
        /NEVER-SERVE-THIS|Noahbrain fixture/,
      );
    }
  } finally {
    await production.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unpacked standalone app runs and retains data in a folder with spaces and Korean characters", () => {
  const directory = mkdtempSync(join(tmpdir(), "Noah Flow 한글 "));
  mkdirSync(join(directory, "server"));
  mkdirSync(join(directory, "dist"));
  copyFileSync(
    fileURLToPath(new URL("../server/app.mjs", import.meta.url)),
    join(directory, "server", "app.mjs"),
  );
  copyFileSync(
    fileURLToPath(new URL("../server/instagram.mjs", import.meta.url)),
    join(directory, "server", "instagram.mjs"),
  );
  writeFileSync(
    join(directory, "dist", "index.html"),
    "<!doctype html><title>Unpacked standalone app</title>",
  );
  writeFileSync(
    join(directory, "check.mjs"),
    `import { createApp } from './server/app.mjs';
const app = createApp();
app.store.update('automation-guide', { name: 'Saved after unpacking' });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
let html;
try {
  const response = await fetch('http://127.0.0.1:' + app.server.address().port + '/');
  html = await response.text();
  if (response.status !== 200) throw new Error('Static app did not load');
} finally { await app.close(); }
const reopened = createApp();
try { console.log(JSON.stringify({ html, name: reopened.store.automation('automation-guide').name })); }
finally { reopened.store.close(); }
`,
  );
  try {
    const result = spawnSync(process.execPath, ["check.mjs"], {
      cwd: directory,
      env: { ...process.env, DB_PATH: "" },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const output = JSON.parse(result.stdout.trim());
    assert.match(output.html, /Unpacked standalone app/);
    assert.equal(output.name, "Saved after unpacking");
    assert.equal(existsSync(join(directory, "data", "noahbrain.sqlite")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
