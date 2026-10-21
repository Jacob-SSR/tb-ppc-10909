// POST /api/auth/logout — ลบ cookie (session อื่นของผู้ใช้คนเดิมยังอยู่ จนกว่าจะหมดอายุหรือเปลี่ยนรหัส)
import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/token";
import { tbDb } from "@/lib/db";
import { clientIp, route } from "@/lib/http";

export const POST = route(async (req) => {
  const u = await getSession();
  if (u) await writeAudit(tbDb, { userId: u.id, action: "logout", entity: "user", entityId: String(u.id), ip: clientIp(req) });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
});
