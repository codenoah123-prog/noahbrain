import { readinessStatus, probeInstagram } from "./instagram.mjs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, promises as files } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const BODY_LIMIT = 64 * 1024;
const DEMO_MODE = { mode: "demo", liveConnected: false };

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function invalid(message, fields) {
  throw new ApiError(400, "VALIDATION_ERROR", message, fields);
}

function text(value, field, max, { required = false } = {}) {
  if (typeof value !== "string")
    invalid(`${field} 항목을 확인해 주세요.`, [field]);
  const result = value.normalize("NFC").trim();
  if (result.length > max || (required && !result))
    invalid(
      `${field} 항목은 ${required ? "1~" : "최대 "}${max}자여야 합니다.`,
      [field],
    );
  return result;
}

function boolean(value, field) {
  if (typeof value !== "boolean")
    invalid(`${field} 항목은 참 또는 거짓이어야 합니다.`, [field]);
  return value;
}

function webUrl(value, field) {
  const result = text(value, field, 2048);
  if (!result) return "";
  try {
    const parsed = new URL(result);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
    return result;
  } catch {
    invalid(`${field}에 올바른 http 또는 https 주소를 입력해 주세요.`, [field]);
  }
}

function normalized(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR");
}

export function validateAutomation(input, postExists) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid("자동화 내용을 확인해 주세요.");
  const name = text(input.name, "name", 100, { required: true });
  const postId = text(input.postId, "postId", 100, { required: true });
  if (!postExists(postId)) invalid("선택한 게시물이 없습니다.", ["postId"]);
  if (!["keywords", "all"].includes(input.triggerType))
    invalid("댓글 조건을 선택해 주세요.", ["triggerType"]);
  if (!Array.isArray(input.keywords) || input.keywords.length > 10)
    invalid("키워드는 최대 10개까지 입력할 수 있습니다.", ["keywords"]);
  const keywords = [
    ...new Map(
      input.keywords.map((value) => {
        const keyword = text(value, "keywords", 40, { required: true });
        return [normalized(keyword), keyword];
      }),
    ).values(),
  ];
  if (input.triggerType === "keywords" && keywords.length === 0)
    invalid("키워드를 하나 이상 입력해 주세요.", ["keywords"]);
  const requireFollow = boolean(input.requireFollow, "requireFollow");
  const replyEnabled = boolean(input.replyEnabled, "replyEnabled");
  const replyText = text(input.replyText ?? "", "replyText", 1000, {
    required: replyEnabled,
  });
  const nonFollowerMessage = text(
    input.nonFollowerMessage ?? "",
    "nonFollowerMessage",
    1000,
    { required: requireFollow },
  );
  if (
    !input.message ||
    typeof input.message !== "object" ||
    Array.isArray(input.message)
  )
    invalid("보낼 메시지를 설정해 주세요.", ["message"]);
  const messageText = text(input.message.text ?? "", "message.text", 2000);
  const imageUrl = webUrl(input.message.imageUrl ?? "", "message.imageUrl");
  if (!Array.isArray(input.message.links) || input.message.links.length > 3)
    invalid("링크는 최대 3개까지 설정할 수 있습니다.", ["message.links"]);
  const links = input.message.links.map((link) => {
    if (!link || typeof link !== "object")
      invalid("링크 내용을 확인해 주세요.", ["message.links"]);
    const label = text(link.label, "message.links.label", 80, {
      required: true,
    });
    const url = webUrl(link.url, "message.links.url");
    if (!url) invalid("링크 주소를 입력해 주세요.", ["message.links.url"]);
    return { label, url };
  });
  if (!messageText && !imageUrl && !links.length)
    invalid("텍스트, 이미지 또는 링크를 하나 이상 추가해 주세요.", ["message"]);
  if (!["active", "paused"].includes(input.status))
    invalid("자동화 상태를 확인해 주세요.", ["status"]);
  return {
    name,
    postId,
    triggerType: input.triggerType,
    keywords,
    requireFollow,
    replyEnabled,
    replyText,
    message: { text: messageText, imageUrl, links },
    nonFollowerMessage,
    status: input.status,
  };
}

const seedPosts = [
  {
    id: "post-1",
    kind: "REEL",
    title: "댓글에 “가이드” 남기면 나만의 콘텐츠 가이드를 보내드려요",
    imageUrl:
      "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=700&auto=format&fit=crop&q=85",
    publishedAt: "2026-10-23T03:00:00.000Z",
    commentCount: 128,
    permalink: "https://www.instagram.com/",
  },
  {
    id: "post-2",
    kind: "REEL",
    title: "하루를 바꾸는 10분, 나의 모닝 루틴",
    imageUrl:
      "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=700&auto=format&fit=crop&q=85",
    publishedAt: "2026-10-21T02:00:00.000Z",
    commentCount: 86,
    permalink: "https://www.instagram.com/",
  },
  {
    id: "post-3",
    kind: "POST",
    title: "이번 주말에는 잠시 쉬어가요 🌿",
    imageUrl:
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=700&auto=format&fit=crop&q=85",
    publishedAt: "2026-10-19T06:00:00.000Z",
    commentCount: 54,
    permalink: "https://www.instagram.com/",
  },
  {
    id: "post-4",
    kind: "POST",
    title: "매일 쓰는 작업 도구들을 소개합니다",
    imageUrl:
      "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=700&auto=format&fit=crop&q=85",
    publishedAt: "2026-10-17T04:30:00.000Z",
    commentCount: 92,
    permalink: "https://www.instagram.com/",
  },
  {
    id: "post-5",
    kind: "REEL",
    title: "초보 크리에이터를 위한 작은 기록 습관",
    imageUrl:
      "https://images.unsplash.com/photo-1455390582262-044cdead277a?w=700&auto=format&fit=crop&q=85",
    publishedAt: "2026-10-15T01:00:00.000Z",
    commentCount: 41,
    permalink: "https://www.instagram.com/",
  },
  {
    id: "post-6",
    kind: "POST",
    title: "우리의 다음 여행은 어디로 갈까요?",
    imageUrl:
      "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=700&auto=format&fit=crop&q=85",
    publishedAt: "2026-10-13T03:00:00.000Z",
    commentCount: 67,
    permalink: "https://www.instagram.com/",
  },
];

function automationSeed(postId, name, keywords, requireFollow) {
  return {
    name,
    postId,
    triggerType: "keywords",
    keywords,
    requireFollow,
    replyEnabled: true,
    replyText: "관심 가져주셔서 감사해요! DM을 확인해 주세요 💌",
    message: {
      text: "안녕하세요! 요청하신 자료를 보내드려요. 좋은 하루 보내세요 ✨",
      imageUrl: "",
      links: [{ label: "가이드 보러 가기", url: "https://example.com/guide" }],
    },
    nonFollowerMessage:
      "자료를 받으려면 계정을 팔로우한 뒤 이 DM에 ‘확인’이라고 답장해 주세요 💚",
    status: "active",
  };
}

class Store {
  constructor(path, { seed = true } = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, event_key TEXT UNIQUE NOT NULL, automation_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    if (
      seed &&
      !this.db.prepare("SELECT value FROM metadata WHERE key=?").get("seeded")
    ) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const post of seedPosts)
          this.db
            .prepare("INSERT OR IGNORE INTO posts VALUES (?,?)")
            .run(post.id, JSON.stringify(post));
        this.insertAutomation(
          automationSeed(
            "post-1",
            "콘텐츠 가이드 나눔",
            ["가이드", "자료"],
            true,
          ),
          "automation-guide",
        );
        this.insertAutomation(
          {
            ...automationSeed(
              "post-2",
              "모닝 루틴 체크리스트",
              ["루틴", "체크리스트"],
              false,
            ),
            status: "paused",
          },
          "automation-routine",
        );
        this.db.prepare("INSERT INTO metadata VALUES (?,?)").run("seeded", "1");
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  posts() {
    return this.db
      .prepare("SELECT payload FROM posts")
      .all()
      .map((row) => {
        const post = JSON.parse(row.payload);
        return { ...post, thumbnail: `/media/${post.id}.svg` };
      });
  }
  post(id) {
    const row = this.db.prepare("SELECT payload FROM posts WHERE id=?").get(id);
    if (!row) return null;
    const post = JSON.parse(row.payload);
    return { ...post, thumbnail: `/media/${post.id}.svg` };
  }
  rawAutomation(id) {
    const row = this.db
      .prepare("SELECT payload FROM automations WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.payload) : null;
  }
  automation(id) {
    const data = this.rawAutomation(id);
    if (!data)
      throw new ApiError(404, "NOT_FOUND", "자동화를 찾을 수 없습니다.");
    const counts = { sent: 0, pending: 0, skipped: 0 };
    for (const row of this.db
      .prepare(
        "SELECT status, count(*) AS total FROM deliveries WHERE automation_id=? GROUP BY status",
      )
      .all(id)) {
      counts[row.status === "pending_follow" ? "pending" : row.status] =
        row.total;
    }
    return { ...data, post: this.post(data.postId), counts };
  }
  automations() {
    return this.db
      .prepare("SELECT id FROM automations ORDER BY rowid DESC")
      .all()
      .map(({ id }) => this.automation(id));
  }
  insertAutomation(data, id = randomUUID()) {
    const now = new Date().toISOString();
    const result = { ...data, id, createdAt: now, updatedAt: now };
    this.db
      .prepare("INSERT INTO automations VALUES (?,?)")
      .run(id, JSON.stringify(result));
    return result;
  }
  create(input) {
    const data = validateAutomation(input, (id) => Boolean(this.post(id)));
    if (
      this.db.prepare("SELECT count(*) AS total FROM automations").get()
        .total >= 100
    )
      throw new ApiError(
        409,
        "LIMIT_REACHED",
        "자동화는 최대 100개까지 만들 수 있습니다.",
      );
    return this.automation(this.insertAutomation(data).id);
  }
  update(id, input) {
    const existing = this.automation(id);
    if (!input || typeof input !== "object" || Array.isArray(input))
      invalid("변경할 내용을 확인해 주세요.");
    if (
      Object.hasOwn(input, "message") &&
      (!input.message ||
        typeof input.message !== "object" ||
        Array.isArray(input.message))
    )
      invalid("보낼 메시지를 확인해 주세요.", ["message"]);
    const merged = {
      ...existing,
      ...input,
      message: input.message
        ? { ...existing.message, ...input.message }
        : existing.message,
    };
    const data = validateAutomation(merged, (postId) =>
      Boolean(this.post(postId)),
    );
    const result = {
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare("UPDATE automations SET payload=? WHERE id=?")
      .run(JSON.stringify(result), id);
    return this.automation(id);
  }
  delete(id) {
    this.automation(id);
    this.db.prepare("DELETE FROM automations WHERE id=?").run(id);
  }
  deliveries() {
    return this.db
      .prepare("SELECT payload FROM deliveries ORDER BY rowid DESC LIMIT 500")
      .all()
      .map(({ payload }) => JSON.parse(payload));
  }
  delivery(id) {
    const row = this.db
      .prepare("SELECT payload FROM deliveries WHERE id=?")
      .get(id);
    if (!row)
      throw new ApiError(404, "NOT_FOUND", "발송 기록을 찾을 수 없습니다.");
    return JSON.parse(row.payload);
  }
  overview() {
    const automations = this.automations();
    const stats = {
      automations: automations.length,
      activeAutomations: automations.filter((item) => item.status === "active")
        .length,
      sent: 0,
      pending: 0,
      skipped: 0,
    };
    for (const row of this.db
      .prepare(
        "SELECT status, count(*) AS total FROM deliveries GROUP BY status",
      )
      .all()) {
      stats[row.status === "pending_follow" ? "pending" : row.status] =
        row.total;
    }
    // Chart days follow the user's Asia/Seoul timezone; timestamps stay ISO UTC.
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const activity = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - (6 - index));
      const date = day.toISOString().slice(0, 10);
      const counts = { sent: 0, pending: 0 };
      for (const row of this.db
        .prepare(
          "SELECT status, count(*) AS total FROM deliveries WHERE date(created_at, '+9 hours')=? GROUP BY status",
        )
        .all(date)) {
        if (row.status === "sent") counts.sent = row.total;
        if (row.status === "pending_follow") counts.pending = row.total;
      }
      return {
        date,
        label: `${day.getUTCMonth() + 1}.${day.getUTCDate()}`,
        ...counts,
      };
    });
    return {
      ...DEMO_MODE,
      stats,
      recentDeliveries: this.deliveries().slice(0, 5),
      activity,
    };
  }
  simulate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      invalid("테스트 댓글 내용을 확인해 주세요.");
    const automationId = text(input.automationId, "automationId", 100, {
      required: true,
    });
    const automation = this.automation(automationId);
    const username = text(input.username, "username", 31, {
      required: true,
    }).replace(/^@/, "");
    if (!/^[A-Za-z0-9_.]{1,30}$/.test(username))
      invalid("사용자 이름은 영문, 숫자, 점, 밑줄을 사용해 주세요.", [
        "username",
      ]);
    const comment = text(input.comment, "comment", 2200, { required: true });
    const isFollower = boolean(input.isFollower, "isFollower");
    const postId =
      input.postId === undefined
        ? automation.postId
        : text(input.postId, "postId", 100, { required: true });
    const eventId =
      input.eventId === undefined
        ? ""
        : text(input.eventId, "eventId", 200, { required: true });
    const eventKey = createHash("sha256")
      .update(
        JSON.stringify([
          automationId,
          eventId || [normalized(username), normalized(comment), postId],
        ]),
      )
      .digest("hex");
    const previous = this.db
      .prepare("SELECT payload FROM deliveries WHERE event_key=?")
      .get(eventKey);
    if (previous)
      return { delivery: JSON.parse(previous.payload), duplicate: true };
    let status = "sent";
    let reason = "테스트 DM 발송 완료";
    if (automation.status !== "active") {
      status = "skipped";
      reason = "일시정지된 자동화";
    } else if (postId !== automation.postId) {
      status = "skipped";
      reason = "대상 게시물 불일치";
    } else if (
      automation.triggerType === "keywords" &&
      !automation.keywords.some((keyword) =>
        normalized(comment).includes(normalized(keyword)),
      )
    ) {
      status = "skipped";
      reason = "키워드 불일치";
    } else if (automation.requireFollow && !isFollower) {
      status = "pending_follow";
      reason = "팔로우 확인 대기";
    }
    const createdAt = new Date().toISOString();
    const personalize = (value) =>
      value.replace(/\{\{\s*username\s*\}\}/g, username);
    const message = {
      ...automation.message,
      text: personalize(automation.message.text),
      links: automation.message.links.map((link) => ({
        ...link,
        label: personalize(link.label),
      })),
    };
    const delivery = {
      id: randomUUID(),
      automationId,
      automationName: automation.name,
      postId,
      username,
      comment,
      isFollower,
      status,
      reason,
      mode: "demo",
      message: status === "skipped" ? null : message,
      reply:
        status !== "skipped" && automation.replyEnabled
          ? personalize(automation.replyText)
          : null,
      nonFollowerMessage:
        status === "pending_follow"
          ? personalize(automation.nonFollowerMessage)
          : null,
      createdAt,
      updatedAt: createdAt,
    };
    this.db
      .prepare("INSERT INTO deliveries VALUES (?,?,?,?,?,?)")
      .run(
        delivery.id,
        eventKey,
        automationId,
        status,
        createdAt,
        JSON.stringify(delivery),
      );
    return { delivery, duplicate: false };
  }
  verifyFollow(id, input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      invalid("팔로우 확인 내용을 확인해 주세요.");
    const isFollower = boolean(input.isFollower, "isFollower");
    const delivery = this.delivery(id);
    if (delivery.status === "sent") return { delivery, duplicate: true };
    if (delivery.status !== "pending_follow")
      throw new ApiError(
        409,
        "NOT_PENDING",
        "팔로우 확인 대기 중인 기록만 변경할 수 있습니다.",
      );
    const automation = this.rawAutomation(delivery.automationId);
    if (!automation)
      throw new ApiError(
        409,
        "AUTOMATION_UNAVAILABLE",
        "자동화가 삭제되어 발송할 수 없습니다.",
      );
    if (automation.status !== "active")
      throw new ApiError(
        409,
        "AUTOMATION_PAUSED",
        "자동화를 활성화한 뒤 다시 확인해 주세요.",
      );
    if (!isFollower) return { delivery, duplicate: false };
    const result = {
      ...delivery,
      status: "sent",
      reason: "팔로우 확인 후 테스트 DM 발송 완료",
      isFollower: true,
      nonFollowerMessage: null,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare("UPDATE deliveries SET status=?, payload=? WHERE id=?")
      .run(result.status, JSON.stringify(result), id);
    return { delivery: result, duplicate: false };
  }
  close() {
    this.db.close();
  }
}

async function readBody(request) {
  const contentType = request.headers["content-type"]?.split(";")[0].trim();
  if (contentType !== "application/json")
    throw new ApiError(
      415,
      "CONTENT_TYPE",
      "application/json 형식으로 요청해 주세요.",
    );
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > BODY_LIMIT)
      throw new ApiError(413, "BODY_TOO_LARGE", "요청 내용이 너무 큽니다.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 형식이 올바르지 않습니다.");
  }
}

function respond(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function serveStatic(request, response, pathname, staticDirectory) {
  if (!staticDirectory) return false;
  const decodedPath = decodeURIComponent(pathname);
  if (
    decodedPath.includes("\0") ||
    decodedPath.split("/").some((part) => part.startsWith("."))
  )
    return false;
  let root;
  try {
    root = await files.realpath(staticDirectory);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return false;
    throw error;
  }
  const requested = resolve(root, "." + decodedPath);
  if (!inside(root, requested)) return false;
  let filename;
  try {
    filename = await files.realpath(requested);
    if (!inside(root, filename) || !(await files.stat(filename)).isFile())
      filename = null;
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
  }
  if (!filename) {
    // File requests must not receive HTML; extensionless browser routes use SPA fallback.
    if (extname(decodedPath)) return false;
    try {
      filename = await files.realpath(resolve(root, "index.html"));
      if (!inside(root, filename) || !(await files.stat(filename)).isFile())
        return false;
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return false;
      throw error;
    }
  }
  const body = await files.readFile(filename);
  response.writeHead(200, {
    "Content-Type":
      CONTENT_TYPES[extname(filename).toLowerCase()] ||
      "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
}

export function createApp({
  dbPath = process.env.DB_PATH ||
    fileURLToPath(new URL("../data/noahbrain.sqlite", import.meta.url)),
  seed = true,
  instagramEnv = process.env,
  instagramFetch = globalThis.fetch,
  staticDir = fileURLToPath(new URL("../dist/", import.meta.url)),
} = {}) {
  const store = new Store(dbPath, { seed });
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      const method = request.method;
      if (method === "GET" && path === "/api/health")
        return respond(response, 200, { ok: true, ...DEMO_MODE });
      if (method === "GET" && path === "/api/instagram/status")
        return respond(response, 200, readinessStatus(instagramEnv));
      if (method === "POST" && path === "/api/instagram/probe") {
        const input = await readBody(request);
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new ApiError(
            400,
            "INVALID_PROBE_INPUT",
            "연결 검사는 서버 설정만 사용합니다. 입력은 빈 객체여야 합니다.",
          );
        const result = await probeInstagram({
          env: instagramEnv,
          fetchImpl: instagramFetch,
        });
        return respond(
          response,
          result.ok ? 200 : result.readiness.configured ? 502 : 412,
          result,
        );
      }
      if (method === "GET" && path === "/api/posts")
        return respond(response, 200, { posts: store.posts() });
      if (method === "GET" && path === "/api/overview")
        return respond(response, 200, store.overview());
      if (method === "GET" && path === "/api/automations")
        return respond(response, 200, { automations: store.automations() });
      if (method === "POST" && path === "/api/automations")
        return respond(response, 201, {
          automation: store.create(await readBody(request)),
        });
      if (method === "GET" && path === "/api/deliveries")
        return respond(response, 200, { deliveries: store.deliveries() });
      if (method === "POST" && path === "/api/simulate")
        return respond(response, 200, store.simulate(await readBody(request)));
      const automationMatch = path.match(/^\/api\/automations\/([^/]+)$/);
      if (automationMatch && method === "GET")
        return respond(response, 200, {
          automation: store.automation(decodeURIComponent(automationMatch[1])),
        });
      if (automationMatch && method === "PATCH")
        return respond(response, 200, {
          automation: store.update(
            decodeURIComponent(automationMatch[1]),
            await readBody(request),
          ),
        });
      if (automationMatch && method === "DELETE") {
        store.delete(decodeURIComponent(automationMatch[1]));
        return respond(response, 200, { ok: true });
      }
      const followMatch = path.match(
        /^\/api\/deliveries\/([^/]+)\/verify-follow$/,
      );
      if (followMatch && method === "POST")
        return respond(
          response,
          200,
          store.verifyFollow(
            decodeURIComponent(followMatch[1]),
            await readBody(request),
          ),
        );
      if (
        ["GET", "HEAD"].includes(method) &&
        path !== "/api" &&
        !path.startsWith("/api/")
      ) {
        if (await serveStatic(request, response, path, staticDir)) return;
      }
      throw new ApiError(404, "NOT_FOUND", "요청한 경로를 찾을 수 없습니다.");
    } catch (error) {
      if (error instanceof ApiError)
        return respond(response, error.status, {
          error: {
            code: error.code,
            message: error.message,
            ...(error.fields ? { fields: error.fields } : {}),
          },
        });
      if (error instanceof URIError)
        return respond(response, 400, {
          error: {
            code: "INVALID_PATH",
            message: "요청 경로가 올바르지 않습니다.",
          },
        });
      console.error("API request failed:", error.message);
      respond(response, 500, {
        error: {
          code: "INTERNAL_ERROR",
          message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
      });
    }
  });
  return {
    server,
    store,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => {
          store.close();
          error ? reject(error) : resolve();
        }),
      ),
  };
}
