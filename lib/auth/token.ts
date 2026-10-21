// lib/auth/token.ts — session token ใน cookie (HMAC-SHA256 ด้วย SESSION_SECRET)
// รูปแบบ: base64url(JSON payload) + "." + base64url(signature)
// proxy.ts ตรวจแค่ลายเซ็น + วันหมดอายุ (ไม่แตะ DB); route handler ตรวจกับ DB อีกชั้นใน getSession()
// ไฟล์นี้ใช้ได้ทั้งใน proxy และ route handler (Node.js runtime ทั้งคู่)

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tb_session";
export const SESSION_MAX_AGE_SEC = 12 * 60 * 60; // 12 ชม. (ทั้งกะ) แล้ว login ใหม่

export interface SessionToken {
  uid: number;
  /** tb_users.session_version ตอนออก token — ไม่ตรงกับ DB = ถูกตัด session */
  sv: number;
  /** ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน (proxy พาไปหน้าเปลี่ยนรหัส) */
  mcp: boolean;
  exp: number; // unix seconds
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createToken(t: Omit<SessionToken, "exp">, now = Date.now()): string {
  const payload: SessionToken = { ...t, exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SEC };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined | null, now = Date.now()): SessionToken | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionToken;
    if (!Number.isInteger(t.uid) || !Number.isInteger(t.sv) || typeof t.exp !== "number") return null;
    if (t.exp * 1000 <= now) return null;
    return t;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // เปิด https ผ่าน Cloudflare Tunnel ทีหลัง: ตั้ง COOKIE_SECURE=1
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge,
  };
}
