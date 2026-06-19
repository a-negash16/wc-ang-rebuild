import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 6 * 60 * 60;

export function createManagerSessionToken({ groupSlug, managerCode, managerName, role = "manager" }) {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = {
    group_slug: groupSlug,
    manager_code: managerCode,
    manager_name: managerName,
    role,
    exp: expiresAt,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return {
    token: `${encodedPayload}.${signature}`,
    expires_at: new Date(expiresAt * 1000).toISOString(),
  };
}

export function verifyManagerSessionToken(token) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid session");
  }

  if (!safeEqual(signature, sign(encodedPayload))) {
    throw new Error("Invalid session");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Session expired");
  }
  return payload;
}

function sign(value) {
  const secret = getSessionSecret();
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "local-dev-session-secret-change-before-production";
  throw new Error("SESSION_SECRET is required");
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
