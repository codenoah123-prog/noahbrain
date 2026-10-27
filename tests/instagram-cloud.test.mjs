import test from "node:test";
import assert from "node:assert/strict";
import {
  GraphError,
  probeSubscriptions,
  subscribeInstagram,
  loadAccount,
  getMediaPosts,
  sendPrivateReply,
  processInstagramEvent,
} from "../workers/instagram.mjs";

const NOW = Date.parse("2026-10-27T03:00:00.000Z");
const connection = {
  userId: "111",
  appId: "777",
  username: "owner",
  accessToken: "synthetic-test-token-not-real",
  apiVersion: "v24.0",
  liveEnabled: true,
};
function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status });
}
function rule(overrides = {}) {
  return {
    id: "rule-1",
    name: "자료",
    status: "active",
    postId: "222",
    triggerType: "keywords",
    keywords: ["가이드", "GUIDE"],
    requireFollow: true,
    replyEnabled: false,
    replyText: "",
    nonFollowerMessage: "팔로우한 뒤 확인이라고 답장해 주세요.",
    message: { text: "{{username}}님 자료예요", imageUrl: "", links: [] },
    ...overrides,
  };
}
function comment(overrides = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: "111",
        time: NOW / 1000,
        changes: [
          {
            field: "comments",
            value: {
              id: "333",
              from: { id: "444", username: "friend" },
              text: "가이드 보내주세요",
              media: { id: "222" },
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}
function message(overrides = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: "111",
        time: NOW / 1000,
        messaging: [
          {
            sender: { id: "444" },
            recipient: { id: "111" },
            timestamp: NOW,
            message: { mid: "message-confirm-1", text: "확인" },
            ...overrides,
          },
        ],
      },
    ],
  };
}
class MemoryStore {
  constructor(rules = [rule()]) {
    this.rules = rules;
    this.events = new Map();
    this.flows = new Map();
    this.records = new Map();
  }
  async automations() {
    return structuredClone(this.rules);
  }
  async automation(id) {
    const found = this.rules.find((r) => r.id === id);
    if (!found) throw new Error("missing");
    return structuredClone(found);
  }
  async claimEvent(key) {
    if (this.events.has(key)) return false;
    this.events.set(key, { status: "processing" });
    return true;
  }
  async completeEvent(key, status, code) {
    this.events.set(key, { status, code });
  }
  async savePendingFlow(flow) {
    if (!this.flows.has(flow.id))
      this.flows.set(flow.id, structuredClone(flow));
    return this.flows.get(flow.id);
  }
  async pendingFlowsForRecipient(recipientId) {
    return [...this.flows.values()]
      .filter(
        (f) =>
          f.recipientId === recipientId &&
          f.status === "pending" &&
          Date.parse(f.expiresAt) >= NOW,
      )
      .map((f) => structuredClone(f));
  }
  async claimPendingFlow(id) {
    const flow = this.flows.get(id);
    if (!flow || flow.status !== "pending") return false;
    flow.status = "processing";
    return true;
  }
  async updatePendingFlow(id, status) {
    const flow = this.flows.get(id);
    if (!flow) return false;
    flow.status = status;
    return true;
  }
  async recordDelivery(data, key) {
    if (!this.records.has(key)) this.records.set(key, structuredClone(data));
    return this.records.get(key);
  }
}
function run(store, payload, fetchImpl, options = {}) {
  return processInstagramEvent({
    payload,
    store,
    connection,
    fetchImpl,
    now: () => NOW,
    ...options,
  });
}

test("cloud transport fixed hosts, Bearer protection, explicit version and safe Graph errors", async () => {
  let calls = 0;
  await assert.rejects(
    probeSubscriptions({
      ...connection,
      apiVersion: "https://attacker.invalid",
      fetchImpl: () => {
        calls++;
      },
    }),
    (error) => error.code === "INVALID_API_VERSION",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    probeSubscriptions({
      ...connection,
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(new URL(url).origin, "https://graph.instagram.com");
        assert.equal(
          options.headers.Authorization,
          "Bearer " + connection.accessToken,
        );
        assert.equal(options.redirect, "error");
        assert.ok(!url.includes(connection.accessToken));
        return response(
          {
            error: {
              message: connection.accessToken,
              code: 190,
              error_subcode: 463,
            },
          },
          400,
        );
      },
    }),
    (error) =>
      error instanceof GraphError &&
      error.code === "GRAPH_REJECTED" &&
      error.graphCode === 190 &&
      !JSON.stringify(error).includes(connection.accessToken),
  );
  await assert.rejects(
    probeSubscriptions({
      ...connection,
      fetchImpl: async () => {
        throw new Error("secret " + connection.accessToken);
      },
    }),
    (error) =>
      error.code === "GRAPH_REQUEST_FAILED" &&
      !error.message.includes(connection.accessToken),
  );
});

test("subscription read and explicit subscription write limit returned claims", async () => {
  const calls = [];
  const result = await subscribeInstagram({
    ...connection,
    appId: undefined,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return options.method === "POST"
        ? response({ success: true })
        : response({
            data: [
              {
                id: "secret-app-id",
                subscribed_fields: ["messages", "comments", "unrelated"],
              },
            ],
          });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(
    new URL(calls[0].url).searchParams.get("subscribed_fields"),
    "comments,messages",
  );
  assert.deepEqual(result.fields, ["comments", "messages"]);
  assert.equal(result.appIdentityVerified, false);
  assert.ok(!JSON.stringify(result).includes("secret-app-id"));
});

test("account/media mapping rejects wrong account and does not echo tokens or raw pagination", async () => {
  await assert.rejects(
    loadAccount({
      ...connection,
      fetchImpl: async () => response({ id: "999", username: "wrong" }),
    }),
    (error) => error.code === "ACCOUNT_UNCONFIRMED",
  );
  assert.deepEqual(
    await loadAccount({
      ...connection,
      fetchImpl: async () => response({ id: "111", username: "owner" }),
    }),
    { userId: "111", username: "owner" },
  );
  const posts = await getMediaPosts({
    ...connection,
    fetchImpl: async () =>
      response({
        data: [
          {
            id: "222",
            caption: "실제 릴스",
            media_type: "VIDEO",
            media_product_type: "REELS",
            thumbnail_url: "https://example.com/photo.jpg",
            media_url: "https://example.com/video.mp4",
            permalink: "https://www.instagram.com/reel/example/",
            timestamp: "2026-10-20T00:00:00Z",
            comments_count: 4,
          },
        ],
        paging: {
          next:
            "https://secret.invalid/?access_token=" + connection.accessToken,
        },
      }),
  });
  assert.equal(posts[0].kind, "REEL");
  assert.equal(posts[0].mode, "live");
  assert.equal(posts[0].commentCount, 4);
  assert.ok(!JSON.stringify(posts).includes(connection.accessToken));
});

test("subscription eligibility is bound to the configured Meta app, not another app subscription", async () => {
  const fetchImpl = async () =>
    response({
      data: [
        { id: "555", subscribed_fields: ["comments"] },
        { id: "666", subscribed_fields: ["comments", "messages"] },
      ],
    });
  const ours = await probeSubscriptions({
    ...connection,
    appId: "555",
    fetchImpl,
  });
  assert.equal(ours.appIdentityVerified, true);
  assert.equal(ours.hasComments, true);
  assert.equal(ours.hasMessages, false);
  const missing = await probeSubscriptions({
    ...connection,
    appId: "777",
    fetchImpl,
  });
  assert.equal(missing.appIdentityVerified, false);
  assert.equal(missing.hasComments, false);
  assert.equal(missing.hasMessages, false);
  assert.ok(!JSON.stringify(ours).includes("666"));
});

test("disabled live mode and unrelated, stale, echo, nonmatching events cause no outgoing calls", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("should not call");
  };
  assert.equal(
    (
      await run(new MemoryStore(), comment(), fetchImpl, {
        connection: { liveEnabled: false },
      })
    ).disabled,
    true,
  );
  const other = comment();
  other.entry[0].id = "999";
  await run(new MemoryStore(), other, fetchImpl);
  const stale = comment();
  stale.entry[0].time = (NOW - 8 * 24 * 60 * 60 * 1000) / 1000;
  await run(new MemoryStore(), stale, fetchImpl);
  await run(new MemoryStore(), comment({ text: "관련 없는 댓글" }), fetchImpl);
  await run(
    new MemoryStore(),
    comment({ from: { id: "111", username: "owner" } }),
    fetchImpl,
  );
  await run(
    new MemoryStore(),
    message({ message: { mid: "echo", text: "확인", is_echo: true } }),
    fetchImpl,
  );
  await run(
    new MemoryStore(),
    message({ timestamp: NOW - 25 * 60 * 60 * 1000 }),
    fetchImpl,
  );
  assert.equal(calls, 0);
});

test("keyword comment sends one private notice, maps recipient from Graph, and deduplicates event", async () => {
  const store = new MemoryStore();
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return response({ recipient_id: "444", message_id: "initial-1" });
  };
  const result = await run(store, comment(), fetchImpl);
  assert.equal(result.pending, 1);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.recipient, { comment_id: "333" });
  assert.equal(store.flows.get("333").recipientId, "444");
  assert.equal(store.flows.get("333").status, "pending");
  assert.equal(store.records.get("comment:333").mode, "live");
  assert.equal(store.records.get("comment:333").status, "pending_follow");
  assert.equal((await run(store, comment(), fetchImpl)).duplicate, 1);
  assert.equal(requests.length, 1);
});

test("non-follow plain-text automation can deliver only one initial text reply", async () => {
  const store = new MemoryStore([rule({ requireFollow: false })]);
  const outgoing = [];
  const result = await run(store, comment(), async (url, options) => {
    outgoing.push(JSON.parse(options.body));
    return response({ recipient_id: "444", message_id: "initial-text" });
  });
  assert.equal(result.sent, 1);
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].message.text, "friend님 자료예요");
  assert.equal(store.flows.size, 0);
});

test("confirmation establishes reply context before follower query and delivers rich content once", async () => {
  const store = new MemoryStore([
    rule({
      message: {
        text: "{{username}}님 자료",
        imageUrl: "https://example.com/image.jpg",
        links: [{ label: "자료 보기", url: "https://example.com/guide" }],
      },
    }),
  ]);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({
      url,
      options,
      body: options.body ? JSON.parse(options.body) : null,
    });
    return options.method === "GET"
      ? response({ is_user_follow_business: true })
      : response({ recipient_id: "444", message_id: "m-" + calls.length });
  };
  await run(store, comment(), fetchImpl);
  assert.equal(calls.length, 1);
  const result = await run(store, message(), fetchImpl);
  assert.equal(result.sent, 1);
  assert.equal(calls.length, 5);
  assert.equal(
    new URL(calls[1].url).searchParams.get("fields"),
    "is_user_follow_business",
  );
  assert.equal(calls[2].body.message.text, "friend님 자료");
  assert.equal(calls[3].body.message.attachment.type, "image");
  assert.equal(
    calls[4].body.message.attachment.payload.template_type,
    "button",
  );
  assert.equal(store.flows.get("333").status, "sent");
  await run(store, message(), fetchImpl);
  assert.equal(calls.length, 5);
});

test("false or unknown follower status leaves information unsent and waits for a new confirmation", async () => {
  for (const profile of [
    { is_user_follow_business: false },
    { is_user_follow_business: "true" },
    {},
  ]) {
    const store = new MemoryStore();
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls++;
      return options.method === "GET"
        ? response(profile)
        : response({ recipient_id: "444", message_id: "intro" });
    };
    await run(store, comment(), fetchImpl);
    await run(store, message(), fetchImpl);
    assert.equal(calls, 2);
    assert.equal(store.flows.get("333").status, "pending");
    assert.equal([...store.records.values()].at(-1).status, "pending_follow");
  }
});

test("a rich message without a follower gate still waits for the recipient response", async () => {
  const store = new MemoryStore([
    rule({
      requireFollow: false,
      message: {
        text: "정보",
        imageUrl: "https://example.com/photo.jpg",
        links: [],
      },
    }),
  ]);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options);
    return response({ recipient_id: "444", message_id: "m-" + calls.length });
  };
  await run(store, comment(), fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(store.flows.get("333").status, "pending");
  await run(store, message(), fetchImpl);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.method === "POST"));
});

test("paused/deleted automation, unmatched sender and arbitrary text cannot release pending materials", async () => {
  for (const mode of ["paused", "deleted", "sender", "text"]) {
    const store = new MemoryStore();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return response({ recipient_id: "444", message_id: "intro" });
    };
    await run(store, comment(), fetchImpl);
    if (mode === "paused") store.rules[0].status = "paused";
    if (mode === "deleted") store.rules = [];
    const event =
      mode === "sender"
        ? message({ sender: { id: "555" } })
        : mode === "text"
          ? message({ message: { mid: "other", text: "확인하지 마세요" } })
          : message();
    await run(store, event, fetchImpl);
    assert.equal(calls, 1);
  }
});

test("network uncertainty never automatically retries initial or partially sent follow-up messages", async () => {
  const store = new MemoryStore();
  let calls = 0;
  const failure = async () => {
    calls++;
    throw new Error(connection.accessToken);
  };
  await run(store, comment(), failure);
  await run(store, comment(), failure);
  assert.equal(calls, 1);
  assert.equal(store.records.get("comment:333").status, "failed");
  assert.ok(
    !JSON.stringify([...store.records.values()]).includes(
      connection.accessToken,
    ),
  );
  const second = new MemoryStore();
  let first = true;
  const fetchImpl = async (url, options) => {
    if (first) {
      first = false;
      return response({ recipient_id: "444", message_id: "intro" });
    }
    if (options.method === "GET")
      return response({ is_user_follow_business: true });
    throw new Error("uncertain");
  };
  await run(second, comment(), fetchImpl);
  await run(second, message(), fetchImpl);
  assert.equal(second.flows.get("333").status, "failed");
  const records = second.records.size;
  await run(
    second,
    message({ message: { mid: "new-confirm", text: "확인" } }),
    fetchImpl,
  );
  assert.equal(second.records.size, records);
});

test("public comment failure does not resend an already successful private reply", async () => {
  const store = new MemoryStore([
    rule({ replyEnabled: true, replyText: "DM 확인해 주세요" }),
  ]);
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    return url.endsWith("/replies")
      ? response({ error: { code: 10, message: "not allowed" } }, 400)
      : response({ recipient_id: "444", message_id: "intro" });
  };
  await run(store, comment(), fetchImpl);
  await run(store, comment(), fetchImpl);
  assert.equal(calls, 2);
  assert.equal(store.flows.get("333").status, "pending");
  assert.equal(
    store.records.get("comment:333").publicReplyError,
    "GRAPH_REJECTED",
  );
});

test("concurrent confirmation events can release a pending flow only once", async () => {
  const store = new MemoryStore();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return options.method === "GET"
      ? response({ is_user_follow_business: true })
      : response({ recipient_id: "444", message_id: "m-" + calls.length });
  };
  await run(store, comment(), fetchImpl);
  await Promise.all([
    run(store, message(), fetchImpl),
    run(
      store,
      message({ message: { mid: "other-confirm", text: "확인" } }),
      fetchImpl,
    ),
  ]);
  assert.equal(calls.length, 3);
  assert.equal(store.flows.get("333").status, "sent");
});

test("pending materials from a different owner account or Meta app cannot be released after reconnection", async () => {
  for (const property of ["ownerUserId", "ownerAppId"]) {
    const store = new MemoryStore();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return response({ recipient_id: "444", message_id: "intro" });
    };
    await run(store, comment(), fetchImpl);
    assert.equal(store.flows.get("333").payload.ownerUserId, "111");
    assert.equal(store.flows.get("333").payload.ownerAppId, "777");
    store.flows.get("333").payload[property] = "999";
    await run(store, message(), fetchImpl);
    assert.equal(calls, 1);
    assert.equal(store.flows.get("333").status, "pending");
  }
});

test("the official direct-field comment envelope and multiple matching rules still produce one private reply", async () => {
  const store = new MemoryStore([
    rule(),
    rule({ id: "second-rule", name: "두 번째" }),
  ]);
  let calls = 0;
  const payload = comment();
  const change = payload.entry[0].changes[0];
  delete payload.entry[0].changes;
  Object.assign(payload.entry[0], change);
  const result = await run(store, payload, async () => {
    calls++;
    return response({ recipient_id: "444", message_id: "intro" });
  });
  assert.equal(result.pending, 1);
  assert.equal(calls, 1);
  assert.equal(store.flows.get("333").automationId, "rule-1");
});

test("the initial notice never sends malformed input or exposes uncertain provider responses", async () => {
  let calls = 0;
  await assert.rejects(
    sendPrivateReply({
      ...connection,
      commentId: "not-id",
      text: "안내",
      fetchImpl: () => {
        calls++;
      },
    }),
    (error) => error.code === "INVALID_ACCOUNT_ID",
  );
  await assert.rejects(
    sendPrivateReply({
      ...connection,
      commentId: "333",
      text: "x".repeat(1001),
      fetchImpl: () => {
        calls++;
      },
    }),
    (error) => error.code === "INVALID_MESSAGE",
  );
  assert.equal(calls, 0);
});
