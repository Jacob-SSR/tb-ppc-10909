// lib/repo/common.ts — ของที่ repo ทุกตัวใช้ร่วมกัน
import type mysql from "mysql2/promise";
import type { Queryable } from "../audit.ts";
import { conflict, notFound } from "../errors.ts";
import type { UnitRole } from "../tb/types.ts";

/** ผู้ทำรายการ — มาจาก session (API) หรือ null (สคริปต์ย้ายข้อมูล) */
export interface Actor {
  id: number | null;
  role: UnitRole;
  unitId: number | null;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { id: null, role: "admin", unitId: null };

export type Row = mysql.RowDataPacket & Record<string, unknown>;

/** อ่านแถวพร้อมล็อก (FOR UPDATE) — ไม่พบหรือลบแล้ว = 404 */
export async function lockRow(db: Queryable, table: string, id: string, what: string): Promise<Row> {
  const [rows] = await db.query<Row[]>(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [id]);
  if (!rows[0]) throw notFound(`ไม่พบ${what}`);
  return rows[0];
}

/** optimistic lock — version ที่ฟอร์มถือมาต้องตรงกับใน DB */
export function assertVersion(cur: Row, version: number | undefined): void {
  if (version !== undefined && Number(cur.version) !== version) throw conflict();
}

/** เอาเฉพาะคีย์ที่กำหนด (กันช่องแปลกปลอมจาก client หลุดเข้า SQL) */
export function pick<T extends Record<string, unknown>>(o: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
}
