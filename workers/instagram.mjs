// Official message/profile/subscription contracts:
// https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/postman/instagram-platform-api.postman_collection.json
// Account/media field models: facebook/facebook-python-business-sdk IGUser/IGMedia.
// Real account eligibility and live requests still require validation in the owner's app.

const GRAPH = "https://graph.instagram.com";
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const TIMEOUT = 5000;
const FIELDS = new Set(["comments", "messages", "messaging_postbacks"]);
export const INSTAGRAM_SCOPES = Object.freeze([
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
]);

export class GraphError extends Error {
  constructor(code, message, metadata = {}) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    if (Number.isSafeInteger(metadata.graphCode))
      this.graphCode = metadata.graphCode;
    if (Number.isSafeInteger(metadata.graphSubcode))
      this.graphSubcode = metadata.graphSubcode;
  }
}

function id(value) {
  if (typeof value !== "string" || !/^\d{1,40}$/.test(value))
    throw new GraphError(
      "INVALID_ACCOUNT_ID",
      "Instagram의 숫자 계정·게시물 ID를 확인해 주세요.",
    );
  return value;
}
function version(value) {
  if (typeof value !== "string" || !/^v[1-9]\d{0,2}\.\d{1,2}$/.test(value))
    throw new GraphError(
      "INVALID_API_VERSION",
      "Meta 앱에서 지원하는 API 버전을 확인해 주세요.",
    );
  return value;
}
function token(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 8192 ||
    /[\s\x00-\x1f\x7f]/.test(value)
  )
    throw new GraphError(
      "INVALID_ACCESS_TOKEN",
      "Instagram 액세스 토큰을 설정해 주세요.",
    );
  return value;
}
function credential(input = {}) {
  return {
    accessToken: token(input.accessToken),
    apiVersion: version(input.apiVersion),
    userId: id(input.userId),
  };
}
function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function personalized(value, username) {
  return String(value || "").replace(
    /\{\{\s*username\s*\}\}/g,
    username || "친구",
  );
}
function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR");
}
function millis(value) {
  if (typeof value === "number" || /^\d+$/.test(String(value || ""))) {
    const number = Number(value);
    return number < 1e12 ? number * 1000 : number;
  }
  return typeof value === "string" ? Date.parse(value) : NaN;
}
function isRecent(timestamp, now, window) {
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now + 5 * 60 * 1000 &&
    timestamp >= now - window
  );
}

async function graph({
  accessToken,
  apiVersion,
  path,
  method = "GET",
  query = {},
  body,
  fetchImpl = globalThis.fetch,
}) {
  token(accessToken);
  version(apiVersion);
  if (
    typeof fetchImpl !== "function" ||
    !/^[0-9]{1,40}(?:\/(?:messages|media|subscribed_apps|replies))?$/.test(path)
  )
    throw new GraphError(
      "INVALID_REQUEST",
      "Instagram 요청을 구성할 수 없습니다.",
    );
  const url = new URL(`/${apiVersion}/${path}`, GRAPH);
  for (const [name, value] of Object.entries(query))
    url.searchParams.set(name, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetchImpl(url.href, {
      method,
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > 512 * 1024)
      throw new GraphError(
        "RESPONSE_TOO_LARGE",
        "Instagram 응답 크기를 확인하지 못했습니다.",
      );
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new GraphError(
        "UNEXPECTED_RESPONSE",
        "Instagram의 JSON 응답을 확인하지 못했습니다.",
      );
    }
    if (!response.ok || data?.error) {
      throw new GraphError(
        "GRAPH_REJECTED",
        "Instagram이 요청을 허용하지 않았습니다. 계정·토큰·권한과 API 버전을 확인해 주세요.",
        {
          graphCode: data?.error?.code,
          graphSubcode: data?.error?.error_subcode,
        },
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new GraphError(
        "UNEXPECTED_RESPONSE",
        "Instagram 응답 형식을 확인하지 못했습니다.",
      );
    return data;
  } catch (error) {
    if (error instanceof GraphError) throw error;
    throw new GraphError(
      controller.signal.aborted ? "GRAPH_TIMEOUT" : "GRAPH_REQUEST_FAILED",
      controller.signal.aborted
        ? "Instagram 요청 시간이 초과되었습니다. 자동 재전송하지 않습니다."
        : "Instagram 요청 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSubscriptions(input) {
  const auth = credential(input);
  const configuredAppId =
    input.appId === undefined || input.appId === "" ? null : id(input.appId);
  const data = await graph({
    ...auth,
    path: `${auth.userId}/subscribed_apps`,
    fetchImpl: input.fetchImpl,
  });
  if (
    !Array.isArray(data.data) ||
    data.data.length > 100 ||
    data.data.some((app) => !app || !Array.isArray(app.subscribed_fields))
  )
    throw new GraphError(
      "UNEXPECTED_RESPONSE",
      "예상한 앱 구독 응답을 받지 못했습니다.",
    );
  const matchingApps = configuredAppId
    ? data.data.filter((app) => String(app.id || "") === configuredAppId)
    : data.data;
  const fields = [
    ...new Set(
      matchingApps
        .flatMap((app) => app.subscribed_fields)
        .filter((field) => FIELDS.has(field)),
    ),
  ].sort();
  return {
    appCount: data.data.length,
    fields,
    hasComments: fields.includes("comments"),
    hasMessages: fields.includes("messages"),
    appIdentityVerified: configuredAppId !== null && matchingApps.length === 1,
  };
}

export async function subscribeInstagram(input) {
  const auth = credential(input);
  const data = await graph({
    ...auth,
    path: `${auth.userId}/subscribed_apps`,
    method: "POST",
    query: { subscribed_fields: "comments,messages" },
    fetchImpl: input.fetchImpl,
  });
  if (data.success !== true)
    throw new GraphError(
      "SUBSCRIPTION_UNCONFIRMED",
      "Instagram 구독 등록 성공을 확인하지 못했습니다.",
    );
  return probeSubscriptions(input);
}

export async function loadAccount(input) {
  const auth = credential(input);
  const data = await graph({
    ...auth,
    path: auth.userId,
    query: { fields: "id,username" },
    fetchImpl: input.fetchImpl,
  });
  if (
    String(data.id || "") !== auth.userId ||
    typeof data.username !== "string" ||
    !data.username ||
    data.username.length > 100
  )
    throw new GraphError(
      "ACCOUNT_UNCONFIRMED",
      "설정한 계정의 ID와 사용자명을 확인하지 못했습니다.",
    );
  return { userId: auth.userId, username: data.username };
}

export async function getMediaPosts(input) {
  const auth = credential(input);
  const data = await graph({
    ...auth,
    path: `${auth.userId}/media`,
    query: {
      fields:
        "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,comments_count",
      limit: 25,
    },
    fetchImpl: input.fetchImpl,
  });
  if (!Array.isArray(data.data) || data.data.length > 100)
    throw new GraphError(
      "MEDIA_UNCONFIRMED",
      "계정의 게시물 목록을 확인하지 못했습니다.",
    );
  return data.data
    .filter((item) => item && /^\d{1,40}$/.test(String(item.id || "")))
    .map((item) => ({
      id: String(item.id),
      kind: item.media_product_type === "REELS" ? "REEL" : "POST",
      title:
        typeof item.caption === "string" && item.caption
          ? item.caption.slice(0, 160)
          : "내 Instagram 콘텐츠",
      thumbnail: httpsUrl(item.thumbnail_url) || httpsUrl(item.media_url) || "",
      publishedAt: Number.isFinite(Date.parse(item.timestamp))
        ? new Date(item.timestamp).toISOString()
        : new Date(0).toISOString(),
      commentCount:
        Number.isSafeInteger(item.comments_count) && item.comments_count >= 0
          ? item.comments_count
          : 0,
      permalink: httpsUrl(item.permalink) || "",
      mode: "live",
    }));
}

export async function getFollowerStatus(input) {
  const auth = credential(input);
  const data = await graph({
    ...auth,
    path: id(input.recipientId),
    query: { fields: "is_user_follow_business" },
    fetchImpl: input.fetchImpl,
  });
  return typeof data.is_user_follow_business === "boolean"
    ? data.is_user_follow_business
    : null;
}

export async function sendPrivateReply(input) {
  const auth = credential(input);
  if (
    typeof input.text !== "string" ||
    !input.text.trim() ||
    input.text.length > 1000
  )
    throw new GraphError(
      "INVALID_MESSAGE",
      "최초 안내 DM은 1~1000자의 텍스트로 설정해 주세요.",
    );
  const data = await graph({
    ...auth,
    path: `${auth.userId}/messages`,
    method: "POST",
    body: {
      recipient: { comment_id: id(input.commentId) },
      message: { text: input.text },
    },
    fetchImpl: input.fetchImpl,
  });
  if (
    !/^\d{1,40}$/.test(String(data.recipient_id || "")) ||
    typeof data.message_id !== "string" ||
    !data.message_id
  )
    throw new GraphError(
      "DELIVERY_UNCONFIRMED",
      "최초 DM 발송 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다.",
    );
  return { recipientId: String(data.recipient_id), messageId: data.message_id };
}

async function sendMessage(auth, recipientId, message, fetchImpl) {
  const data = await graph({
    ...auth,
    path: `${auth.userId}/messages`,
    method: "POST",
    body: { recipient: { id: id(recipientId) }, message },
    fetchImpl,
  });
  if (
    String(data.recipient_id || "") !== recipientId ||
    typeof data.message_id !== "string" ||
    !data.message_id
  )
    throw new GraphError(
      "DELIVERY_UNCONFIRMED",
      "DM 발송 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다.",
    );
  return data.message_id;
}

async function publicReply(auth, commentId, text, fetchImpl) {
  const data = await graph({
    ...auth,
    path: `${id(commentId)}/replies`,
    method: "POST",
    body: { message: text },
    fetchImpl,
  });
  if (!/^\d{1,40}$/.test(String(data.id || "")))
    throw new GraphError(
      "PUBLIC_REPLY_UNCONFIRMED",
      "댓글 답글 발송 결과를 확인하지 못했습니다.",
    );
}

function initialNotice(rule, username) {
  if (rule.requireFollow) {
    const text = personalized(rule.nonFollowerMessage, username).trim();
    return (
      text.includes("확인")
        ? text
        : `${text}\n이 DM에 ‘확인’이라고 답장해 주세요.`
    ).slice(0, 1000);
  }
  return "요청하신 자료를 준비했어요. 이 DM에 ‘확인’이라고 답장해 주세요.";
}

function confirmation(text) {
  return (
    typeof text === "string" &&
    normalized(text)
      .trim()
      .replace(/[.!?。！？\s]+$/u, "") === "확인"
  );
}
function safeError(error) {
  return error instanceof GraphError ? error.code : "PROCESSING_FAILED";
}

// Only call after the public receiver has validated the owner's app signature.
// Atomic claims deliberately prevent blind retries after an uncertain network result.
export async function processInstagramEvent({
  payload,
  store,
  connection = {},
  fetchImpl = globalThis.fetch,
  now = Date.now,
}) {
  const summary = { sent: 0, pending: 0, skipped: 0, failed: 0, duplicate: 0 };
  if (connection.liveEnabled !== true) return { ...summary, disabled: true };
  const auth = credential(connection);
  const ownerAppId = id(connection.appId);
  if (
    !payload ||
    payload.object !== "instagram" ||
    !Array.isArray(payload.entry) ||
    payload.entry.length > 100
  )
    throw new GraphError(
      "INVALID_WEBHOOK",
      "Instagram 이벤트 형식을 확인해 주세요.",
    );
  const rules = await store.automations();
  async function record(data, key) {
    await store.recordDelivery(
      {
        ...data,
        eventKey: key,
        mode: "live",
        createdAt: new Date(now()).toISOString(),
      },
      key,
    );
  }
  async function handleComment(entry, comment) {
    if (
      !comment ||
      !/^\d{1,40}$/.test(String(comment.id || "")) ||
      !/^\d{1,40}$/.test(String(comment.media?.id || "")) ||
      typeof comment.text !== "string"
    ) {
      summary.skipped++;
      return;
    }
    if (
      String(comment.from?.id || "") === auth.userId ||
      (connection.username &&
        normalized(comment.from?.username) === normalized(connection.username))
    ) {
      summary.skipped++;
      return;
    }
    if (!comment.from?.id && !comment.from?.username) {
      summary.skipped++;
      return;
    }
    if (
      !isRecent(
        millis(comment.timestamp || comment.created_time || entry.time),
        now(),
        WEEK,
      )
    ) {
      summary.skipped++;
      return;
    }
    const rule = rules.find(
      (item) =>
        item.status === "active" &&
        item.postId === String(comment.media.id) &&
        (item.triggerType === "all" ||
          item.keywords.some((keyword) =>
            normalized(comment.text).includes(normalized(keyword)),
          )),
    );
    if (!rule) {
      summary.skipped++;
      return;
    }
    const key = `comment:${comment.id}`;
    if (!(await store.claimEvent(key))) {
      summary.duplicate++;
      return;
    }
    const username = String(comment.from?.username || "").slice(0, 100);
    const delivery = {
      automationId: rule.id,
      automationName: rule.name,
      username,
      comment: comment.text.slice(0, 2200),
      isFollower: null,
      message: rule.message,
      reply: null,
    };
    try {
      const waiting =
        rule.requireFollow ||
        !!rule.message.imageUrl ||
        rule.message.links.length > 0;
      const text = waiting
        ? initialNotice(rule, username)
        : personalized(rule.message.text, username).trim();
      const result = await sendPrivateReply({
        ...auth,
        commentId: String(comment.id),
        text,
        fetchImpl,
      });
      if (waiting) {
        await store.savePendingFlow({
          id: String(comment.id),
          commentId: String(comment.id),
          recipientId: result.recipientId,
          automationId: rule.id,
          payload: {
            ownerUserId: auth.userId,
            ownerAppId,
            rule: structuredClone(rule),
            username,
            comment: delivery.comment,
          },
          status: "pending",
          createdAt: new Date(now()).toISOString(),
          expiresAt: new Date(now() + WEEK).toISOString(),
        });
      }
      let reply = null;
      let publicReplyError = null;
      if (rule.replyEnabled && rule.replyText?.trim()) {
        try {
          reply = personalized(rule.replyText, username);
          await publicReply(auth, String(comment.id), reply, fetchImpl);
        } catch (error) {
          publicReplyError = safeError(error);
          reply = null;
        }
      }
      await record(
        {
          ...delivery,
          reply,
          publicReplyError,
          status: waiting ? "pending_follow" : "sent",
          reason: waiting
            ? "안내 DM 발송 · 상대의 확인 답장 대기"
            : "최초 텍스트 DM 발송 완료",
          nonFollowerMessage: waiting ? text : null,
          message: waiting ? null : { text, imageUrl: "", links: [] },
          recipientId: result.recipientId,
        },
        key,
      );
      await store.completeEvent(key, "completed");
      summary[waiting ? "pending" : "sent"]++;
    } catch (error) {
      await record(
        {
          ...delivery,
          status: "failed",
          reason: "발송 결과 확인 필요 · 자동 재전송 중지",
          errorCode: safeError(error),
          message: null,
        },
        key,
      );
      await store.completeEvent(key, "failed", safeError(error));
      summary.failed++;
    }
  }
  async function handleMessage(entry, message) {
    if (
      message?.message?.is_echo ||
      String(message?.recipient?.id || "") !== auth.userId ||
      String(message?.sender?.id || "") === auth.userId ||
      !/^\d{1,40}$/.test(String(message?.sender?.id || "")) ||
      !confirmation(message?.message?.text) ||
      typeof message?.message?.mid !== "string" ||
      !message.message.mid ||
      message.message.mid.length > 512
    ) {
      summary.skipped++;
      return;
    }
    const receivedAt = millis(message.timestamp);
    if (!isRecent(receivedAt, now(), DAY)) {
      summary.skipped++;
      return;
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${auth.userId}:${message.message.mid}`),
    );
    const key =
      "message:" +
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    if (!(await store.claimEvent(key))) {
      summary.duplicate++;
      return;
    }
    const recipientId = String(message.sender.id);
    const flows = await store.pendingFlowsForRecipient(recipientId);
    const flow = flows.find(
      (item) =>
        item.payload?.ownerUserId === auth.userId &&
        item.payload?.ownerAppId === ownerAppId,
    );
    if (!flow) {
      await store.completeEvent(key, "ignored");
      summary.skipped++;
      return;
    }
    let current;
    try {
      current = await store.automation(flow.automationId);
    } catch {
      await store.updatePendingFlow(flow.id, "cancelled");
      await store.completeEvent(key, "ignored");
      summary.skipped++;
      return;
    }
    if (current.status !== "active") {
      await store.completeEvent(key, "ignored");
      summary.skipped++;
      return;
    }
    if (!(await store.claimPendingFlow(flow.id))) {
      await store.completeEvent(key, "ignored");
      summary.duplicate++;
      return;
    }
    const rule = flow.payload?.rule;
    if (!rule?.message) {
      await store.updatePendingFlow(flow.id, "failed");
      await store.completeEvent(key, "failed", "INVALID_FLOW");
      summary.failed++;
      return;
    }
    let attempted = false;
    let isFollower = null;
    const delivery = {
      automationId: flow.automationId,
      automationName: rule.name,
      username: flow.payload.username || "",
      comment: flow.payload.comment || "",
      recipientId,
      reply: null,
    };
    try {
      if (rule.requireFollow) {
        isFollower = await getFollowerStatus({
          ...auth,
          recipientId,
          fetchImpl,
        });
        if (isFollower !== true) {
          await store.updatePendingFlow(flow.id, "pending");
          await record(
            {
              ...delivery,
              status: "pending_follow",
              isFollower,
              reason:
                isFollower === false
                  ? "확인 답장 수신 · 팔로우 미확인"
                  : "확인 답장 수신 · 팔로우 조회 결과 확인 필요",
              message: null,
            },
            key,
          );
          await store.completeEvent(key, "completed");
          summary.pending++;
          return;
        }
      }
      const username = flow.payload.username || "";
      const outbound = [];
      const text = personalized(rule.message.text, username).trim();
      if (text.length > 1000)
        throw new GraphError(
          "INVALID_MESSAGE",
          "실제 자료 DM의 텍스트는 1000자 이하로 설정해 주세요.",
        );
      if (text) outbound.push({ text });
      if (rule.message.imageUrl) {
        const image = httpsUrl(rule.message.imageUrl);
        if (!image)
          throw new GraphError(
            "INVALID_MEDIA_URL",
            "실제 DM의 이미지는 공개 HTTPS 주소여야 합니다.",
          );
        outbound.push({
          attachment: { type: "image", payload: { url: image } },
        });
      }
      if (rule.message.links?.length) {
        if (rule.message.links.length > 3)
          throw new GraphError("INVALID_LINKS", "링크 버튼은 최대 3개입니다.");
        const buttons = rule.message.links.map((link) => {
          const url = httpsUrl(link.url);
          if (!url)
            throw new GraphError(
              "INVALID_LINK_URL",
              "실제 DM의 링크는 HTTPS 주소여야 합니다.",
            );
          return {
            type: "web_url",
            url,
            title:
              Array.from(personalized(link.label, username).trim())
                .slice(0, 20)
                .join("") || "링크 보기",
          };
        });
        outbound.push({
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: "요청하신 링크를 확인해 주세요.",
              buttons,
            },
          },
        });
      }
      if (!outbound.length || outbound.length > 3)
        throw new GraphError(
          "INVALID_MESSAGE",
          "자료 메시지 구성을 확인해 주세요.",
        );
      for (const outgoing of outbound) {
        if (!isRecent(receivedAt, now(), DAY))
          throw new GraphError(
            "MESSAGING_WINDOW_EXPIRED",
            "답장 후 허용된 메시지 발송 시간이 지났습니다.",
          );
        attempted = true;
        await sendMessage(auth, recipientId, outgoing, fetchImpl);
      }
      await store.updatePendingFlow(flow.id, "sent");
      await record(
        {
          ...delivery,
          status: "sent",
          reason: "확인 답장 후 자료 DM 발송 완료",
          isFollower,
          message: { ...rule.message, text },
        },
        key,
      );
      await store.completeEvent(key, "completed");
      summary.sent++;
    } catch (error) {
      await store.updatePendingFlow(flow.id, attempted ? "failed" : "pending");
      await record(
        {
          ...delivery,
          status: attempted ? "failed" : "pending_follow",
          reason: attempted
            ? "발송 결과 확인 필요 · 자동 재전송 중지"
            : "발송 전 확인 필요 · 자료 미전송",
          errorCode: safeError(error),
          isFollower,
          message: null,
        },
        key,
      );
      await store.completeEvent(key, "failed", safeError(error));
      summary[attempted ? "failed" : "pending"]++;
    }
  }
  for (const entry of payload.entry) {
    if (!entry || String(entry.id || "") !== auth.userId) {
      summary.skipped++;
      continue;
    }
    if (entry.field === "comments") await handleComment(entry, entry.value);
    if (Array.isArray(entry.changes))
      for (const change of entry.changes)
        if (change?.field === "comments")
          await handleComment(entry, change.value);
    if (Array.isArray(entry.messaging))
      for (const message of entry.messaging)
        await handleMessage(entry, message);
  }
  return summary;
}
