// POST /api/auth/password — เปลี่ยนรหัสผ่านตัวเอง (บังคับครั้งแรก / หลัง admin reset)
// เปลี่ยนแล้ว session_version +1 → เครื่องอื่นที่ login ค้างไว้หลุดหมด, เครื่องนี้ได้ cookie ใหม่
import type mysql from "mysql2/promise";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";
import { createToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/token";
import { withTransaction } from "@/lib/db";
import { badRequest, clientIp, HttpError, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";

const Body = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(1).max(200),
});

export const POST = route(async (req) => {
  const user = await requireUser({ allowMustChange: true });
  const { current, next } = await readJson(req, Body);

  if (!(await rateLimit(`pw:${user.id}`, 10, 15 * 60)).ok) throw new HttpError(429, "ลองบ่อยเกินไป กรุณารอสักครู่");
  const problem = passwordProblem(next, user.username);
  if (problem) throw badRequest(problem);
  if (next === current) throw badRequest("รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม");

  const sv = await withTransaction(async (conn) => {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT password_hash, session_version FROM tb_users WHERE id = ? FOR UPDATE",
      [user.id],
    );
    if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
      throw badRequest("รหัสผ่านปัจจุบันไม่ถูกต้อง");
    }
    const newSv = rows[0].session_version + 1;
    await conn.execute(
      `UPDATE tb_users SET password_hash = ?, must_change_password = 0, session_version = ?,
              password_changed_at = NOW() WHERE id = ?`,
      [await hashPassword(next), newSv, user.id],
    );
    await writeAudit(conn, { userId: user.id, action: "password", entity: "user", entityId: String(user.id), ip: clientIp(req) });
    return newSv;
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createToken({ uid: user.id, sv, mcp: false }), sessionCookieOptions());
  return res;
});
