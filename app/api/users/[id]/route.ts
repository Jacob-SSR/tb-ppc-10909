// PATCH /api/users/:id — แก้ชื่อ/หน่วย, เปิด-ปิดบัญชี, ปลดล็อก, reset รหัสผ่าน (admin)
// ปิดบัญชี / ย้ายหน่วย / reset → session_version +1 ตัด session เดิมทันที
import type mysql from "mysql2/promise";
import { z } from "zod";
import { diff, writeAudit } from "@/lib/audit";
import { hashPassword, temporaryPassword } from "@/lib/auth/password";
import { requireAdmin } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { badRequest, clientIp, notFound, readJson, route } from "@/lib/http";

const Body = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  unitId: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  unlock: z.literal(true).optional(),
  resetPassword: z.literal(true).optional(),
});

export const PATCH = route(async (req, ctx: RouteContext<"/api/users/[id]">) => {
  const admin = await requireAdmin();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) throw notFound();
  const body = await readJson(req, Body);
  if (id === admin.id && (body.active === false || (body.unitId && body.unitId !== admin.unitId))) {
    throw badRequest("ปิดบัญชีหรือย้ายหน่วยของตัวเองไม่ได้");
  }

  const out = await withTransaction(async (conn) => {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id, display_name, unit_id, active FROM tb_users WHERE id = ? FOR UPDATE",
      [id],
    );
    const cur = rows[0];
    if (!cur) throw notFound("ไม่พบผู้ใช้");
    if (body.unitId !== undefined) {
      const [u] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM tb_units WHERE id = ? AND active = 1", [body.unitId]);
      if (!u.length) throw badRequest("ไม่พบหน่วยบริการ");
    }

    const next = {
      display_name: body.displayName ?? cur.display_name,
      unit_id: body.unitId ?? cur.unit_id,
      active: body.active === undefined ? cur.active : body.active ? 1 : 0,
    };
    const changes: Record<string, [unknown, unknown]> = diff(cur, next, ["display_name", "unit_id", "active"]);
    const killSessions = !!body.resetPassword || "unit_id" in changes || next.active === 0;
    let tempPassword: string | null = null;

    await conn.execute(
      `UPDATE tb_users SET display_name = ?, unit_id = ?, active = ?,
              session_version = session_version + ? WHERE id = ?`,
      [next.display_name, next.unit_id, next.active, killSessions ? 1 : 0, id],
    );
    if (body.unlock) {
      await conn.execute("UPDATE tb_users SET failed_logins = 0, locked_until = NULL WHERE id = ?", [id]);
      changes.unlock = [null, true];
    }
    if (body.resetPassword) {
      tempPassword = temporaryPassword();
      await conn.execute(
        "UPDATE tb_users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?",
        [await hashPassword(tempPassword), id],
      );
      changes.password = [null, "reset"];
    }
    if (Object.keys(changes).length) {
      await writeAudit(conn, { userId: admin.id, action: "save", entity: "user", entityId: String(id), changes, ip: clientIp(req) });
    }
    return { tempPassword };
  });
  return Response.json({ ok: true, ...out });
});
