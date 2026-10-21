// lib/audit.ts — tb_audit_log: ทุกการเพิ่ม/แก้/ลบ/login (ใคร เมื่อไร IP อะไร เปลี่ยนจากอะไรเป็นอะไร)
// เขียนใน transaction เดียวกับข้อมูลหลักเสมอ (ส่ง conn ของ transaction เข้ามา)
import type mysql from "mysql2/promise";

export type Queryable = Pick<mysql.Pool | mysql.PoolConnection, "query" | "execute">;

export type AuditEntity = "patient" | "contact" | "visit" | "settings" | "user" | "system";

/** {"ช่อง": [ค่าเดิม, ค่าใหม่]} */
export type Changes = Record<string, [unknown, unknown]>;

export interface AuditEntry {
  userId: number | null;
  action: string; // add / save / delete / login / login_failed / logout / password / import / migrate / settings / convert
  entity: AuditEntity;
  entityId?: string | null;
  patientId?: string | null;
  changes?: Changes | Record<string, unknown> | null;
  ip?: string | null;
}

export async function writeAudit(db: Queryable, a: AuditEntry): Promise<void> {
  await db.execute(
    `INSERT INTO tb_audit_log (user_id, action, entity, entity_id, patient_id, changes, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      a.userId,
      a.action.slice(0, 20),
      a.entity,
      a.entityId ?? null,
      a.patientId ?? null,
      a.changes && Object.keys(a.changes).length ? JSON.stringify(a.changes) : null,
      a.ip?.slice(0, 45) ?? null,
    ],
  );
}

const norm = (v: unknown) => (v === undefined || v === "" ? null : v instanceof Date ? v.toISOString() : v);

/**
 * เทียบสองแถวเฉพาะคีย์ที่ระบุ → {คีย์: [เดิม, ใหม่]} เฉพาะที่เปลี่ยน
 * before = null คือเพิ่มใหม่ (เก็บเฉพาะช่องที่มีค่า)
 */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  keys: readonly string[] = Object.keys(after),
): Changes {
  const out: Changes = {};
  for (const k of keys) {
    if (!(k in after)) continue;
    const a = norm(before?.[k]);
    const b = norm(after[k]);
    // ตัวเลขจาก DB อาจมาเป็นสตริง (DECIMAL) — เทียบแบบสตริงพอ
    if (String(a ?? "") !== String(b ?? "")) out[k] = [a, b];
  }
  return out;
}
