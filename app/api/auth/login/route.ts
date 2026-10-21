// POST /api/auth/login — บัญชีรายคน + bcrypt + ล็อกเมื่อผิดหลายครั้ง + rate limit (CLAUDE.md §3)
import type mysql from "mysql2/promise";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/password";
import { createToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/token";
import { tbDb } from "@/lib/db";
import { clientIp, HttpError, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";

const MAX_FAILS = 5; // ผิดครบ 5 ครั้งติด → ล็อก
const LOCK_MINUTES = 15;

const Body = z.object({
  username: z.string().trim().toLowerCase().min(1).max(50),
  password: z.string().min(1).max(200),
});

interface LoginRow extends mysql.RowDataPacket {
  id: number;
  password_hash: string;
  active: number;
  unit_active: number;
  failed_logins: number;
  locked_until: string | null;
  locked: number;
  must_change_password: number;
  session_version: number;
}

const WRONG = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";

export const POST = route(async (req) => {
  const ip = clientIp(req);
  const { username, password } = await readJson(req, Body);

  // rate limit ทั้งราย IP และราย username (กันไล่เดาหลายบัญชี / หลายเครื่อง)
  const [byIp, byUser] = await Promise.all([
    rateLimit(`login:ip:${ip ?? "unknown"}`, 30, 15 * 60),
    rateLimit(`login:user:${username}`, 10, 15 * 60),
  ]);
  if (!byIp.ok || !byUser.ok) {
    const wait = Math.ceil(Math.max(byIp.retryAfterSec, byUser.retryAfterSec) / 60);
    throw new HttpError(429, `ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอ ${wait} นาที`);
  }

  const [rows] = await tbDb.query<LoginRow[]>(
    `SELECT u.id, u.password_hash, u.active, un.active AS unit_active, u.failed_logins,
            u.locked_until, (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS locked,
            u.must_change_password, u.session_version
       FROM tb_users u JOIN tb_units un ON un.id = u.unit_id
      WHERE u.username = ?`,
    [username],
  );
  const u = rows[0];

  if (!u) {
    await burnPasswordCheck(password);
    await writeAudit(tbDb, { userId: null, action: "login_failed", entity: "user", changes: { username }, ip });
    throw new HttpError(401, WRONG);
  }

  if (u.locked) {
    await writeAudit(tbDb, { userId: u.id, action: "login_locked", entity: "user", entityId: String(u.id), ip });
    throw new HttpError(423, `บัญชีถูกล็อกชั่วคราวเพราะใส่รหัสผิดหลายครั้ง ลองใหม่หลังเวลา ${u.locked_until?.slice(11, 16)} น. หรือติดต่อผู้ดูแล`);
  }

  if (!(await verifyPassword(password, u.password_hash))) {
    const fails = u.failed_logins + 1;
    const lock = fails >= MAX_FAILS;
    await tbDb.execute(
      `UPDATE tb_users
          SET failed_logins = ?, locked_until = IF(?, NOW() + INTERVAL ${LOCK_MINUTES} MINUTE, locked_until)
        WHERE id = ?`,
      [lock ? 0 : fails, lock, u.id],
    );
    await writeAudit(tbDb, {
      userId: u.id, action: lock ? "login_locked" : "login_failed", entity: "user", entityId: String(u.id), ip,
    });
    throw new HttpError(401, lock
      ? `ใส่รหัสผิด ${MAX_FAILS} ครั้ง บัญชีถูกล็อก ${LOCK_MINUTES} นาที`
      : WRONG);
  }

  if (!u.active || !u.unit_active) {
    await writeAudit(tbDb, { userId: u.id, action: "login_failed", entity: "user", entityId: String(u.id), changes: { reason: "inactive" }, ip });
    throw new HttpError(403, "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแล");
  }

  await tbDb.execute(
    "UPDATE tb_users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?",
    [u.id],
  );
  await writeAudit(tbDb, { userId: u.id, action: "login", entity: "user", entityId: String(u.id), ip });

  const mustChange = !!u.must_change_password;
  const res = NextResponse.json({ ok: true, mustChangePassword: mustChange });
  res.cookies.set(SESSION_COOKIE, createToken({ uid: u.id, sv: u.session_version, mcp: mustChange }), sessionCookieOptions());
  return res;
});
