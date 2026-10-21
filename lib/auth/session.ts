// lib/auth/session.ts — ผู้ใช้ของ request ปัจจุบัน (ตรวจกับ DB ทุกครั้ง)
// proxy.ts ตรวจลายเซ็นแล้ว แต่ที่นี่เช็คซ้ำ + เช็คว่าบัญชี/หน่วยยังเปิดอยู่ และ session ยังไม่ถูกตัด
import { cookies } from "next/headers";
import type mysql from "mysql2/promise";
import { tbDb } from "../db.ts";
import { forbidden, HttpError } from "../errors.ts";
import type { UnitRole } from "../tb/types.ts";
import { SESSION_COOKIE, verifyToken } from "./token.ts";

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  unitId: number;
  unitName: string;
  role: UnitRole;
  mustChangePassword: boolean;
  sessionVersion: number;
}

interface UserRow extends mysql.RowDataPacket {
  id: number;
  username: string;
  display_name: string;
  unit_id: number;
  unit_name: string;
  role: UnitRole;
  active: number;
  unit_active: number;
  must_change_password: number;
  session_version: number;
}

export async function loadUser(id: number): Promise<(SessionUser & { active: boolean }) | null> {
  const [rows] = await tbDb.query<UserRow[]>(
    `SELECT u.id, u.username, u.display_name, u.unit_id, un.name AS unit_name, un.role,
            u.active, un.active AS unit_active, u.must_change_password, u.session_version
       FROM tb_users u JOIN tb_units un ON un.id = u.unit_id
      WHERE u.id = ?`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    unitId: r.unit_id,
    unitName: r.unit_name,
    role: r.role,
    mustChangePassword: !!r.must_change_password,
    sessionVersion: r.session_version,
    active: !!r.active && !!r.unit_active,
  };
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const t = verifyToken(store.get(SESSION_COOKIE)?.value);
  if (!t) return null;
  const u = await loadUser(t.uid);
  if (!u || !u.active || u.sessionVersion !== t.sv) return null;
  return {
    id: u.id, username: u.username, displayName: u.displayName, unitId: u.unitId, unitName: u.unitName,
    role: u.role, mustChangePassword: u.mustChangePassword, sessionVersion: u.sessionVersion,
  };
}

/** ต้อง login — ถ้ายังต้องเปลี่ยนรหัสผ่าน ใช้ API อื่นไม่ได้ (ยกเว้น allowMustChange) */
export async function requireUser(opts: { allowMustChange?: boolean } = {}): Promise<SessionUser> {
  const u = await getSession();
  if (!u) throw new HttpError(401, "กรุณาเข้าสู่ระบบ");
  if (u.mustChangePassword && !opts.allowMustChange) {
    throw new HttpError(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน", { mustChangePassword: true });
  }
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "admin") throw forbidden("เฉพาะทีม รพ. (ผู้ดูแล) เท่านั้น");
  return u;
}

export const isAdmin = (u: Pick<SessionUser, "role">) => u.role === "admin";
