import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = "wc26_session";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function safeEqual(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export class Auth {
  constructor({ password, secret }) {
    this.password = password ?? "";
    this.secret = secret || "wc26-dev-secret-change-me";
    this.cookieName = COOKIE_NAME;
  }

  get enabled() {
    return this.password.length > 0;
  }

  checkPassword(candidate) {
    if (!this.enabled) {
      return false;
    }
    return safeEqual(String(candidate ?? ""), this.password);
  }

  sign(payload) {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  createToken() {
    const expires = Date.now() + SESSION_TTL_MS;
    const payload = base64url(JSON.stringify({ expires }));
    const signature = this.sign(payload);
    return `${payload}.${signature}`;
  }

  verifyToken(token) {
    if (!token || typeof token !== "string") {
      return false;
    }

    const [payload, signature] = token.split(".");
    if (!payload || !signature) {
      return false;
    }

    if (!safeEqual(signature, this.sign(payload))) {
      return false;
    }

    try {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return typeof decoded.expires === "number" && decoded.expires > Date.now();
    } catch {
      return false;
    }
  }

  parseCookies(header) {
    const cookies = {};
    if (!header) {
      return cookies;
    }

    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index === -1) {
        continue;
      }
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      cookies[key] = decodeURIComponent(value);
    }

    return cookies;
  }

  isAdminRequest(req) {
    if (!this.enabled) {
      return false;
    }
    const cookies = this.parseCookies(req.headers.cookie);
    return this.verifyToken(cookies[this.cookieName]);
  }

  buildSessionCookie(token, { secure }) {
    const attributes = [
      `${this.cookieName}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    ];
    if (secure) {
      attributes.push("Secure");
    }
    return attributes.join("; ");
  }

  buildClearCookie({ secure }) {
    const attributes = [
      `${this.cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0"
    ];
    if (secure) {
      attributes.push("Secure");
    }
    return attributes.join("; ");
  }
}
