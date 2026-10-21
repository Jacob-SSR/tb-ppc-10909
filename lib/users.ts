// lib/users.ts — จัดการบัญชีผู้ใช้ (ใช้ทั้ง API ของ admin และสคริปต์สร้าง admin คนแรก)
import type mysql from "mysql2/promise";
import { type Queryable, writeAudit } from "./audit.ts";
import { hashPassword, temporaryPassword } from "./auth/password.ts";

export const USERNAME_RE = /^[a-z0-9._-]{3,50}$/;

export interface UserListRow {
  id: number;
  username: string;
  display_name: string;
  unit_id: number;
  unit_name: string;
  role: "admin" | "unit";
  active: number;
  must_change_password: number;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

export async function listUsers(db: Queryable): Promise<UserListRow[]> {
  const [rows] = await db.query<(UserListRow & mysql.RowDataPacket)[]>(
    `SELECT u.id, u.username, u.display_name, u.unit_id, un.name AS unit_name, un.role, u.active,
            u.must_change_password, u.failed_logins,
            IF(u.locked_until > NOW(), u.locked_until, NULL) AS locked_until,
            u.last_login_at, u.created_at
       FROM tb_users u JOIN tb_units un ON un.id = u.unit_id
      ORDER BY un.id, u.display_name`,
  );
  return rows;
}

/** สร้างบัญชีพร้อมรหัสชั่วคราว (ผู้ใช้ต้องเปลี่ยนตอน login ครั้งแรก) — คืนรหัสชั่วคราวให้แสดงครั้งเดียว */
export async function createUser(
  db: Queryable,
  input: { username: string; displayName: string; unitId: number },
  actor: { userId: number | null; ip?: string | null },
): Promise<{ id: number; tempPassword: string }> {
  const tempPassword = temporaryPassword();
  const [r] = await db.execute<mysql.ResultSetHeader>(
    `INSERT INTO tb_users (unit_id, username, display_name, password_hash, must_change_password)
     VALUES (?, ?, ?, ?, 1)`,
    [input.unitId, input.username, input.displayName, await hashPassword(tempPassword)],
  );
  await writeAudit(db, {
    userId: actor.userId,
    action: "add",
    entity: "user",
    entityId: String(r.insertId),
    changes: { username: [null, input.username], display_name: [null, input.displayName], unit_id: [null, input.unitId] },
    ip: actor.ip,
  });
  return { id: r.insertId, tempPassword };
}
