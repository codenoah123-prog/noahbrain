// Cloudflare Worker / D1 persistence. No Node runtime or external network calls.
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
  const messageText = text(input.message.text ?? "", "message.text", 1000);
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

export const seedPosts = [
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

export const SCHEMA =
  "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);\nCREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);\nCREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);\nCREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, automation_id TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'demo', created_at TEXT NOT NULL, payload TEXT NOT NULL);\nCREATE INDEX IF NOT EXISTS deliveries_automation_status ON deliveries (automation_id, status);\nCREATE INDEX IF NOT EXISTS deliveries_mode_created ON deliveries (mode, created_at);\nCREATE TABLE IF NOT EXISTS webhook_events (event_key TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, error_code TEXT);\nCREATE TABLE IF NOT EXISTS pending_flows (id TEXT PRIMARY KEY, comment_id TEXT NOT NULL UNIQUE, recipient_id TEXT NOT NULL, automation_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL);\nCREATE INDEX IF NOT EXISTS pending_flows_recipient_status ON pending_flows (recipient_id, status, expires_at);\nCREATE TABLE IF NOT EXISTS oauth_states (state_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);\nCREATE INDEX IF NOT EXISTS oauth_states_expiry ON oauth_states (expires_at);\nCREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);\nCREATE INDEX IF NOT EXISTS auth_attempts_expiry ON auth_attempts (expires_at);\n\nCREATE INDEX IF NOT EXISTS pending_flows_automation_status ON pending_flows (automation_id, status, expires_at);\n";

const initialized = new WeakMap();
const encoder = new TextEncoder();
const STATUSES = new Set([
  "sent",
  "pending_follow",
  "skipped",
  "failed",
  "uncertain",
]);
const countsTemplate = () => ({
  sent: 0,
  pending: 0,
  skipped: 0,
  failed: 0,
  uncertain: 0,
});
const countKey = (status) => (status === "pending_follow" ? "pending" : status);
const nowIso = () => new Date().toISOString();

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new ApiError(
      500,
      "INVALID_STORED_DATA",
      "저장된 데이터를 읽지 못했습니다.",
    );
  }
}
function json(value, max = 128 * 1024) {
  const result = JSON.stringify(value);
  if (result === undefined || encoder.encode(result).byteLength > max)
    invalid("저장할 데이터가 너무 크거나 올바르지 않습니다.");
  return result;
}
function safeKey(value, field = "key", max = 300) {
  return text(value, field, max, { required: true });
}
function iso(value, fallback = nowIso()) {
  const date = new Date(value ?? fallback);
  if (!Number.isFinite(date.getTime())) invalid("날짜 형식을 확인해 주세요.");
  return date.toISOString();
}
function noCredentialKeys(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      /^(access_token|accessToken|app_secret|appSecret|authorization|client_secret|clientSecret)$/i.test(
        key,
      )
    )
      throw new ApiError(
        500,
        "CREDENTIAL_STORAGE_BLOCKED",
        "기록에 자격 증명을 저장할 수 없습니다.",
      );
    noCredentialKeys(child);
  }
}
function decorateAutomation(row) {
  const data = parseJson(row.payload);
  const counts = countsTemplate();
  for (const status of STATUSES)
    counts[countKey(status)] = Number(row[`count_${status}`] || 0);
  return {
    ...data,
    post: row.post_payload ? parseJson(row.post_payload) : null,
    counts,
  };
}
const AUTOMATION_QUERY = `SELECT a.payload, p.payload AS post_payload,
  COALESCE(d.count_sent,0) AS count_sent,
  CASE WHEN (SELECT json_extract(value,'$') FROM metadata WHERE key='posts_mode')='live'
    THEN (SELECT COUNT(*) FROM pending_flows pf WHERE pf.automation_id=a.id AND pf.status IN ('pending','processing') AND pf.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ELSE COALESCE(d.count_pending_follow,0) END AS count_pending_follow,
  COALESCE(d.count_skipped,0) AS count_skipped, COALESCE(d.count_failed,0) AS count_failed,
  COALESCE(d.count_uncertain,0) AS count_uncertain
  FROM automations a LEFT JOIN posts p ON p.id=a.post_id
  LEFT JOIN (SELECT automation_id,
    SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS count_sent,
    SUM(CASE WHEN status='pending_follow' THEN 1 ELSE 0 END) AS count_pending_follow,
    SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) AS count_skipped,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS count_failed,
    SUM(CASE WHEN status='uncertain' THEN 1 ELSE 0 END) AS count_uncertain
    FROM deliveries WHERE mode=COALESCE((SELECT json_extract(value, '$') FROM metadata WHERE key='posts_mode'),'demo') GROUP BY automation_id) d ON d.automation_id=a.id`;

export class D1Store {
  constructor(db) {
    if (
      !db ||
      typeof db.prepare !== "function" ||
      typeof db.exec !== "function"
    )
      throw new ApiError(
        503,
        "DATABASE_REQUIRED",
        "데이터 저장소 연결이 필요합니다.",
      );
    this.db = db;
  }

  async init() {
    let pending = initialized.get(this.db);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => this.db.exec(SCHEMA))
        .catch((error) => {
          initialized.delete(this.db);
          throw error;
        });
      initialized.set(this.db, pending);
    }
    await pending;
    return this;
  }
  async first(sql, ...values) {
    await this.init();
    return this.db
      .prepare(sql)
      .bind(...values)
      .first();
  }
  async rows(sql, ...values) {
    await this.init();
    return (
      (
        await this.db
          .prepare(sql)
          .bind(...values)
          .all()
      ).results || []
    );
  }
  async run(sql, ...values) {
    await this.init();
    return this.db
      .prepare(sql)
      .bind(...values)
      .run();
  }

  async seedDemoOnce() {
    await this.init();
    if (await this.getSetting("seeded")) return;
    const statements = [];
    for (const value of seedPosts) {
      const post = {
        ...value,
        imageUrl: `/media/${value.id}.svg`,
        thumbnail: `/media/${value.id}.svg`,
        mode: "demo",
      };
      statements.push(
        this.db
          .prepare(
            "INSERT OR IGNORE INTO posts (id,payload) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM metadata WHERE key='seeded')",
          )
          .bind(post.id, json(post)),
      );
    }
    const firstRule = automationSeed(
      "post-1",
      "콘텐츠 가이드 나눔",
      ["가이드", "자료"],
      true,
    );
    const secondRule = {
      ...automationSeed(
        "post-2",
        "모닝 루틴 체크리스트",
        ["루틴", "체크리스트"],
        false,
      ),
      status: "paused",
    };
    const now = nowIso();
    for (const [id, input] of [
      ["automation-guide", firstRule],
      ["automation-routine", secondRule],
    ]) {
      const value = { ...input, id, createdAt: now, updatedAt: now };
      statements.push(
        this.db
          .prepare(
            "INSERT OR IGNORE INTO automations (id,post_id,payload,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM metadata WHERE key='seeded')",
          )
          .bind(id, value.postId, json(value), now),
      );
    }
    statements.push(
      this.db.prepare(
        "INSERT OR IGNORE INTO metadata (key,value) VALUES ('posts_mode','\"demo\"')",
      ),
    );
    statements.push(
      this.db.prepare(
        "INSERT OR IGNORE INTO metadata (key,value) VALUES ('seeded','true')",
      ),
    );
    await this.db.batch(statements);
  }

  async posts() {
    return (await this.rows("SELECT payload FROM posts ORDER BY rowid")).map(
      (row) => parseJson(row.payload),
    );
  }
  async post(id) {
    const row = await this.first("SELECT payload FROM posts WHERE id=?", id);
    return row ? parseJson(row.payload) : null;
  }
  async replacePosts(values) {
    if (!Array.isArray(values) || values.length > 200)
      invalid("게시물 목록은 최대 200개까지 저장할 수 있습니다.");
    const posts = values.map((value) => {
      if (!value || typeof value !== "object")
        invalid("게시물 내용을 확인해 주세요.");
      const id = safeKey(value.id, "post.id", 100);
      const title =
        text(value.title ?? "", "post.title", 3000) || "제목 없는 콘텐츠";
      if (!["REEL", "POST"].includes(value.kind))
        invalid("게시물 유형을 확인해 주세요.");
      const thumbnail = webUrl(
        value.thumbnail ?? value.imageUrl ?? "",
        "post.thumbnail",
      );
      const publishedAt = iso(value.publishedAt);
      const commentCount =
        Number.isSafeInteger(value.commentCount) && value.commentCount >= 0
          ? value.commentCount
          : 0;
      return {
        id,
        title,
        kind: value.kind,
        thumbnail,
        imageUrl: thumbnail,
        publishedAt,
        commentCount,
        permalink: webUrl(value.permalink ?? "", "post.permalink"),
        mode: "live",
      };
    });
    if (new Set(posts.map((post) => post.id)).size !== posts.length)
      invalid("게시물 ID가 중복되었습니다.");
    await this.init();
    const statements = [this.db.prepare("DELETE FROM posts")];
    for (let start = 0; start < posts.length; start += 40) {
      const chunk = posts.slice(start, start + 40);
      statements.push(
        this.db
          .prepare(
            "INSERT INTO posts (id,payload) VALUES " +
              chunk.map(() => "(?,?)").join(","),
          )
          .bind(...chunk.flatMap((post) => [post.id, json(post)])),
      );
    }
    statements.push(
      this.db.prepare(
        "INSERT INTO metadata (key,value) VALUES ('posts_mode','\"live\"') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ),
    );
    statements.push(
      this.db.prepare(
        "INSERT OR IGNORE INTO metadata (key,value) VALUES ('seeded','true')",
      ),
    );
    await this.db.batch(statements);
    return posts;
  }

  async rawAutomation(id) {
    const row = await this.first(
      "SELECT payload FROM automations WHERE id=?",
      id,
    );
    return row ? parseJson(row.payload) : null;
  }
  async automation(id) {
    const row = await this.first(AUTOMATION_QUERY + " WHERE a.id=?", id);
    if (!row)
      throw new ApiError(404, "NOT_FOUND", "자동화를 찾을 수 없습니다.");
    return decorateAutomation(row);
  }
  async automations() {
    return (
      await this.rows(
        AUTOMATION_QUERY + " ORDER BY a.created_at DESC,a.id DESC",
      )
    ).map(decorateAutomation);
  }
  async create(input) {
    const postId = input?.postId;
    const post = typeof postId === "string" ? await this.post(postId) : null;
    const data = validateAutomation(input, (id) =>
      Boolean(post && post.id === id),
    );
    const id = crypto.randomUUID();
    const now = nowIso();
    const result = { ...data, id, createdAt: now, updatedAt: now };
    const inserted = await this.run(
      "INSERT INTO automations (id,post_id,payload,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM automations)<100",
      id,
      data.postId,
      json(result),
      now,
    );
    if (!inserted.meta?.changes)
      throw new ApiError(
        409,
        "LIMIT_REACHED",
        "자동화는 최대 100개까지 만들 수 있습니다.",
      );
    return this.automation(id);
  }
  async update(id, input) {
    const existing = await this.automation(id);
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
    const post =
      typeof merged.postId === "string" ? await this.post(merged.postId) : null;
    const data = validateAutomation(merged, (postId) =>
      Boolean(post && post.id === postId),
    );
    const result = {
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };
    await this.run(
      "UPDATE automations SET post_id=?,payload=? WHERE id=?",
      data.postId,
      json(result),
      id,
    );
    return this.automation(id);
  }
  async delete(id) {
    await this.automation(id);
    await this.run("DELETE FROM automations WHERE id=?", id);
  }
  async deliveries() {
    return (
      await this.rows(
        "SELECT payload FROM deliveries ORDER BY created_at DESC,rowid DESC LIMIT 500",
      )
    ).map((row) => parseJson(row.payload));
  }
  async delivery(id) {
    const row = await this.first(
      "SELECT payload FROM deliveries WHERE id=?",
      id,
    );
    if (!row)
      throw new ApiError(404, "NOT_FOUND", "발송 기록을 찾을 수 없습니다.");
    return parseJson(row.payload);
  }
  async recordDelivery(input, eventKey) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      invalid("발송 기록을 확인해 주세요.");
    noCredentialKeys(input);
    const id =
      typeof input.id === "string"
        ? safeKey(input.id, "delivery.id", 120)
        : crypto.randomUUID();
    const key = safeKey(
      eventKey ?? input.eventKey ?? `record:${id}`,
      "delivery.eventKey",
    );
    const automationId = safeKey(
      input.automationId,
      "delivery.automationId",
      100,
    );
    const status = safeKey(input.status, "delivery.status", 40);
    if (!/^[a-z_]+$/.test(status)) invalid("발송 상태 형식을 확인해 주세요.");
    const mode = input.mode === "live" ? "live" : "demo";
    const createdAt = iso(input.createdAt);
    const payload = {
      ...input,
      id,
      automationId,
      status,
      mode,
      createdAt,
      updatedAt: iso(input.updatedAt, createdAt),
    };
    delete payload.eventKey;
    await this.run(
      "INSERT OR IGNORE INTO deliveries (id,event_key,automation_id,status,mode,created_at,payload) VALUES (?,?,?,?,?,?,?)",
      id,
      key,
      automationId,
      status,
      mode,
      createdAt,
      json(payload),
    );
    const row = await this.first(
      "SELECT payload FROM deliveries WHERE event_key=?",
      key,
    );
    return row ? parseJson(row.payload) : this.delivery(id);
  }

  async overview() {
    const mode =
      (await this.getSetting("posts_mode")) === "live" ? "live" : "demo";
    const automations = await this.automations();
    const stats = {
      automations: automations.length,
      activeAutomations: automations.filter(
        (value) => value.status === "active",
      ).length,
      ...countsTemplate(),
    };
    for (const row of await this.rows(
      "SELECT status,COUNT(*) AS total FROM deliveries WHERE mode=? GROUP BY status",
      mode,
    )) {
      const key = countKey(row.status);
      if (Object.hasOwn(stats, key)) stats[key] = Number(row.total);
    }
    if (mode === "live")
      stats.pending = Number(
        (
          await this.first(
            "SELECT COUNT(*) AS total FROM pending_flows WHERE status IN ('pending','processing') AND expires_at>?",
            nowIso(),
          )
        )?.total || 0,
      );
    const local = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const activity = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(local);
      day.setUTCDate(day.getUTCDate() - (6 - index));
      return {
        date: day.toISOString().slice(0, 10),
        label: `${day.getUTCMonth() + 1}.${day.getUTCDate()}`,
        sent: 0,
        pending: 0,
      };
    });
    const firstDay = new Date(
      activity[0].date + "T00:00:00+09:00",
    ).toISOString();
    const activityRows = await this.rows(
      "SELECT date(created_at,'+9 hours') AS day,status,COUNT(*) AS total FROM deliveries WHERE mode=? AND created_at>=? GROUP BY day,status",
      mode,
      firstDay,
    );
    for (const row of activityRows) {
      const day = activity.find((value) => value.date === row.day);
      if (day && row.status === "sent") day.sent = Number(row.total);
      if (day && row.status === "pending_follow")
        day.pending = Number(row.total);
    }
    return {
      mode,
      liveConnected: mode === "live",
      stats,
      activity,
      recentDeliveries: (await this.deliveries()).slice(0, 5),
    };
  }

  async simulate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      invalid("테스트 댓글 내용을 확인해 주세요.");
    const automationId = text(input.automationId, "automationId", 100, {
      required: true,
    });
    const automation = await this.automation(automationId);
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
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(
        JSON.stringify([
          automationId,
          eventId || [normalized(username), normalized(comment), postId],
        ]),
      ),
    );
    const eventKey =
      "demo:" +
      Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    const previous = await this.first(
      "SELECT payload FROM deliveries WHERE event_key=?",
      eventKey,
    );
    if (previous)
      return { delivery: parseJson(previous.payload), duplicate: true };
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
    const createdAt = nowIso();
    const delivery = {
      id: crypto.randomUUID(),
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
    const inserted = await this.run(
      "INSERT OR IGNORE INTO deliveries (id,event_key,automation_id,status,mode,created_at,payload) VALUES (?,?,?,?,?,?,?)",
      delivery.id,
      eventKey,
      automationId,
      status,
      "demo",
      createdAt,
      json(delivery),
    );
    const stored = await this.first(
      "SELECT payload FROM deliveries WHERE event_key=?",
      eventKey,
    );
    return {
      delivery: parseJson(stored.payload),
      duplicate: !inserted.meta?.changes,
    };
  }
  async verifyFollow(id, input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      invalid("팔로우 확인 내용을 확인해 주세요.");
    const isFollower = boolean(input.isFollower, "isFollower");
    const delivery = await this.delivery(id);
    if (delivery.mode !== "demo")
      throw new ApiError(
        409,
        "LIVE_DELIVERY",
        "실제 발송 기록은 테스트 확인으로 변경할 수 없습니다.",
      );
    if (delivery.status === "sent") return { delivery, duplicate: true };
    if (delivery.status !== "pending_follow")
      throw new ApiError(
        409,
        "NOT_PENDING",
        "팔로우 확인 대기 중인 기록만 변경할 수 있습니다.",
      );
    const automation = await this.rawAutomation(delivery.automationId);
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
      updatedAt: nowIso(),
    };
    const updated = await this.run(
      "UPDATE deliveries SET status='sent',payload=? WHERE id=? AND status='pending_follow' AND mode='demo'",
      json(result),
      id,
    );
    return {
      delivery: await this.delivery(id),
      duplicate: !updated.meta?.changes,
    };
  }

  async getSetting(key) {
    const row = await this.first(
      "SELECT value FROM metadata WHERE key=?",
      safeKey(key),
    );
    return row ? parseJson(row.value) : null;
  }
  async setSetting(key, value) {
    await this.run(
      "INSERT INTO metadata (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      safeKey(key),
      json(value),
    );
  }
  async deleteSetting(key) {
    await this.run("DELETE FROM metadata WHERE key=?", safeKey(key));
  }
  async claimEvent(eventKey) {
    const result = await this.run(
      "INSERT OR IGNORE INTO webhook_events (event_key,status,created_at) VALUES (?,'processing',?)",
      safeKey(eventKey),
      nowIso(),
    );
    return Boolean(result.meta?.changes);
  }
  async completeEvent(eventKey, status = "completed", errorCode = null) {
    await this.run(
      "UPDATE webhook_events SET status=?,error_code=? WHERE event_key=?",
      safeKey(status, "status", 40),
      errorCode == null ? null : text(String(errorCode), "errorCode", 100),
      safeKey(eventKey),
    );
  }

  async savePendingFlow(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      invalid("대기 정보를 확인해 주세요.");
    noCredentialKeys(input);
    const id =
      typeof input.id === "string"
        ? safeKey(input.id, "flow.id", 120)
        : crypto.randomUUID();
    const commentId = safeKey(input.commentId ?? id, "flow.commentId", 120);
    const recipientId = safeKey(input.recipientId, "flow.recipientId", 100);
    const automationId = safeKey(input.automationId, "flow.automationId", 100);
    const createdAt = iso(input.createdAt);
    const status = input.status ?? "pending";
    if (
      !["pending", "processing", "sent", "failed", "cancelled"].includes(status)
    )
      invalid("대기 처리 상태를 확인해 주세요.");
    const expiresAt = iso(
      input.expiresAt,
      new Date(Date.parse(createdAt) + 7 * 86400000).toISOString(),
    );
    const value = {
      ...input,
      id,
      commentId,
      recipientId,
      automationId,
      createdAt,
      status,
      expiresAt,
    };
    await this.run(
      "INSERT OR IGNORE INTO pending_flows (id,comment_id,recipient_id,automation_id,payload,created_at,status,expires_at) VALUES (?,?,?,?,?,?,?,?)",
      id,
      commentId,
      recipientId,
      automationId,
      json(value),
      createdAt,
      status,
      expiresAt,
    );
    const row = await this.first(
      "SELECT payload,status FROM pending_flows WHERE comment_id=?",
      commentId,
    );
    return row ? { ...parseJson(row.payload), status: row.status } : null;
  }
  async pendingFlowsForRecipient(recipientId) {
    return (
      await this.rows(
        "SELECT payload,status FROM pending_flows WHERE recipient_id=? AND status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT 20",
        safeKey(recipientId, "recipientId", 100),
        nowIso(),
      )
    ).map((row) => ({ ...parseJson(row.payload), status: row.status }));
  }
  async claimPendingFlow(id) {
    const result = await this.run(
      "UPDATE pending_flows SET status='processing' WHERE id=? AND status='pending' AND expires_at>?",
      safeKey(id, "flow.id", 120),
      nowIso(),
    );
    return Boolean(result.meta?.changes);
  }
  async updatePendingFlow(id, status, patch = {}) {
    if (status && typeof status === "object") {
      patch = status;
      status = patch.status;
    }
    if (
      !["pending", "processing", "sent", "failed", "cancelled"].includes(status)
    )
      invalid("대기 처리 상태를 확인해 주세요.");
    const existing = await this.first(
      "SELECT payload,status FROM pending_flows WHERE id=?",
      safeKey(id, "flow.id", 120),
    );
    if (!existing)
      throw new ApiError(404, "NOT_FOUND", "대기 정보를 찾을 수 없습니다.");
    if (patch.expectedStatus && existing.status !== patch.expectedStatus)
      return false;
    const value = { ...parseJson(existing.payload), ...patch, status };
    delete value.expectedStatus;
    noCredentialKeys(value);
    const result = await this.run(
      "UPDATE pending_flows SET status=?,payload=? WHERE id=? AND status=?",
      status,
      json(value),
      id,
      existing.status,
    );
    return Boolean(result.meta?.changes);
  }
  async saveOAuthState(stateKey, payload, expiresAt) {
    if (!/^[a-f0-9]{64}$/i.test(stateKey))
      invalid("인증 상태 키 형식을 확인해 주세요.");
    const expiry =
      typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt);
    if (!Number.isSafeInteger(expiry) || expiry <= Date.now())
      invalid("인증 상태 만료 시간을 확인해 주세요.");
    await this.init();
    await this.db.batch([
      this.db
        .prepare("DELETE FROM oauth_states WHERE expires_at<=?")
        .bind(Date.now()),
      this.db
        .prepare(
          "INSERT INTO oauth_states (state_key,payload,expires_at) VALUES (?,?,?)",
        )
        .bind(stateKey, json(payload), expiry),
    ]);
  }
  async takeOAuthState(stateKey) {
    if (!/^[a-f0-9]{64}$/i.test(stateKey)) return null;
    const row = await this.first(
      "DELETE FROM oauth_states WHERE state_key=? AND expires_at>? RETURNING payload",
      stateKey,
      Date.now(),
    );
    return row ? parseJson(row.payload) : null;
  }
  async consumeLoginAttempt(key, options = {}) {
    if (typeof options === "number") options = { now: options };
    const now = options.now ?? Date.now();
    const limit = options.limit ?? 10;
    const windowMs = options.windowMs ?? 600000;
    if (
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1
    )
      invalid("로그인 제한 설정을 확인해 주세요.");
    const row = await this.first(
      `INSERT INTO auth_attempts (key,count,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.expires_at<=? THEN 1 ELSE auth_attempts.count+1 END,
      expires_at=CASE WHEN auth_attempts.expires_at<=? THEN ? ELSE auth_attempts.expires_at END RETURNING count`,
      safeKey(key),
      now + windowMs,
      now,
      now,
      now + windowMs,
    );
    return Number(row.count) <= limit;
  }
}

export { D1Store as Store };
