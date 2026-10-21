// GET /api/users — รายชื่อผู้ใช้, POST — สร้างบัญชีใหม่ (admin)
import type mysql from "mysql2/promise";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { tbDb, withTransaction } from "@/lib/db";
import { badRequest, clientIp, readJson, route } from "@/lib/http";
import { createUser, listUsers, USERNAME_RE } from "@/lib/users";

const Body = z.object({
  username: z.string().trim().toLowerCase().regex(USERNAME_RE, "ใช้ a-z 0-9 . _ - ความยาว 3–50 ตัว"),
  displayName: z.string().trim().min(1).max(100),
  unitId: z.number().int().positive(),
});

export const GET = route(async () => {
  await requireAdmin();
  return Response.json({ users: await listUsers(tbDb) });
});

export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const body = await readJson(req, Body);
  const result = await withTransaction(async (conn) => {
    const [dup] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM tb_users WHERE username = ?", [body.username]);
    if (dup.length) throw badRequest("ชื่อผู้ใช้นี้มีอยู่แล้ว");
    const [unit] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM tb_units WHERE id = ? AND active = 1", [body.unitId]);
    if (!unit.length) throw badRequest("ไม่พบหน่วยบริการ");
    return createUser(conn, body, { userId: admin.id, ip: clientIp(req) });
  });
  return Response.json(result, { status: 201 });
});
