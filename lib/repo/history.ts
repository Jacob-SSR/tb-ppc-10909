// lib/repo/history.ts — ประวัติการแก้ไขของผู้ป่วย/ผู้สัมผัส (รวม visit และนัดที่ผูกอยู่) จาก tb_audit_log
// user unit: ดูได้เฉพาะผู้สัมผัสในเขต และเห็นเฉพาะรายการที่หน่วยตัวเองทำ + ที่ย้ายจากระบบเดิม (§5.1)
import type { Queryable } from "../audit.ts";
import { forbidden, notFound } from "../errors.ts";
import type { Actor, Row } from "./common.ts";

export async function loadHistory(db: Queryable, id: string, actor: Actor): Promise<Row[]> {
  const isPatient = id.startsWith("P");
  const table = isPatient ? "tb_patients" : "tb_contacts";
  const [own] = await db.query<Row[]>(`SELECT id${isPatient ? "" : ", unit_id"} FROM ${table} WHERE id = ?`, [id]);
  if (!own[0]) throw notFound();
  if (actor.role !== "admin" && (isPatient || own[0].unit_id !== actor.unitId)) throw forbidden();

  const [rows] = await db.query<Row[]>(
    `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.changes,
            u.display_name AS by_name, un.name AS by_unit_name, u.unit_id AS by_unit_id
       FROM tb_audit_log a
       LEFT JOIN tb_users u ON u.id = a.user_id
       LEFT JOIN tb_units un ON un.id = u.unit_id
      WHERE (a.entity = ? AND a.entity_id = ?)
         OR (a.entity = 'visit' AND a.entity_id IN (SELECT v.id FROM tb_visits v WHERE v.${isPatient ? "patient_id" : "contact_id"} = ?))
         OR (a.entity = 'appointment' AND a.entity_id IN (SELECT n.id FROM tb_appointments n WHERE n.${isPatient ? "patient_id" : "contact_id"} = ?))
      ORDER BY a.at DESC, a.id DESC
      LIMIT 300`,
    [isPatient ? "patient" : "contact", id, id, id],
  );
  return actor.role === "admin" ? rows : rows.filter((r) => r.by_unit_id === actor.unitId || r.by_unit_id === null);
}
