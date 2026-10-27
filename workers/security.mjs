const encoder = new TextEncoder();
const decoder = new TextDecoder();
const COOKIE = "__Host-noahflow";
function bytes(value) {
  return encoder.encode(value);
}
function base64url(buffer) {
  let value = "";
  for (const byte of new Uint8Array(buffer)) value += String.fromCharCode(byte);
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function unbase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid encoding");
  const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
export function passwordConfigured(password) {
  return (
    typeof password === "string" &&
    password.length >= 20 &&
    password.length <= 512 &&
    new Set(password).size >= 8
  );
}
export function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i++) result |= left[i] ^ right[i];
  return result === 0;
}
export async function sha256(value) {
  return base64url(await crypto.subtle.digest("SHA-256", bytes(value)));
}
export async function verifyPassword(value, expected) {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !passwordConfigured(expected)
  )
    return false;
  return equalBytes(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))),
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(expected))),
  );
}
async function hmac(value, password, label) {
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, bytes(label + ":" + value)),
  );
}
export async function webhookVerifyToken(password) {
  return base64url(await hmac("verify", password, "noahflow-webhook-v1"));
}
export async function createSession(password, now = Date.now()) {
  const csrf = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const payload = base64url(
    bytes(JSON.stringify({ exp: now + 6 * 60 * 60 * 1000, csrf })),
  );
  const value =
    payload +
    "." +
    base64url(await hmac(payload, password, "noahflow-session-v1"));
  return {
    csrf,
    value,
    cookie: `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=21600`,
  };
}
export async function readSession(request, password, now = Date.now()) {
  if (!passwordConfigured(password)) return null;
  const cookie = request.headers.get("Cookie") || "";
  const value = cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  if (!value || value.length > 1024) return null;
  try {
    const [payload, signature, extra] = value.split(".");
    if (extra !== undefined) return null;
    if (
      !equalBytes(
        unbase64url(signature),
        await hmac(payload, password, "noahflow-session-v1"),
      )
    )
      return null;
    const session = JSON.parse(decoder.decode(unbase64url(payload)));
    if (
      !Number.isFinite(session.exp) ||
      session.exp <= now ||
      session.exp > now + 21600000 ||
      typeof session.csrf !== "string" ||
      session.csrf.length < 20
    )
      return null;
    return session;
  } catch {
    return null;
  }
}
export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export function validMutation(request, session) {
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    !!session &&
    equalBytes(
      bytes(request.headers.get("X-CSRF-Token") || ""),
      bytes(session.csrf),
    )
  );
}
async function encryptionKey(password) {
  const material = await crypto.subtle.importKey(
    "raw",
    bytes(password),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bytes("noahflow-d1-v1"),
      info: bytes("instagram-connection"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptText(plain, password) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: bytes("noahflow-connection-v1") },
    await encryptionKey(password),
    bytes(plain),
  );
  return "v1." + base64url(iv) + "." + base64url(encrypted);
}
export async function decryptText(cipher, password) {
  if (typeof cipher !== "string" || cipher.length > 40000)
    throw new Error("연결 정보를 읽지 못했습니다.");
  const [version, iv, data, extra] = cipher.split(".");
  if (version !== "v1" || extra !== undefined)
    throw new Error("연결 정보를 읽지 못했습니다.");
  return decoder.decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unbase64url(iv),
        additionalData: bytes("noahflow-connection-v1"),
      },
      await encryptionKey(password),
      unbase64url(data),
    ),
  );
}
export async function verifyWebhook(raw, signature, secret) {
  if (
    typeof signature !== "string" ||
    !/^sha256=[0-9a-f]{64}$/i.test(signature) ||
    !secret
  )
    return false;
  const supplied = Uint8Array.from(signature.slice(7).match(/../g), (hex) =>
    parseInt(hex, 16),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return equalBytes(
    supplied,
    new Uint8Array(await crypto.subtle.sign("HMAC", key, raw)),
  );
}
