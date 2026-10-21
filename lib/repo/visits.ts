// lib/repo/visits.ts — บันทึกการรักษา/ติดตามรายครั้ง
// user unit: บันทึกได้เฉพาะผู้สัมผัสในเขต (ของผู้ป่วยไม่ได้), แก้ได้เฉพาะที่หน่วยตัวเองบันทึก, ลบ = admin
// client_uuid: เครื่องที่เน็ตหลุดส่งร่างซ้ำ → คืนรายการเดิม ไม่สร้างซ้ำ
import { diff, type Queryable, writeAudit } from "../audit.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import { enqueue } from "../outbox.ts";
import { newEntityId } from "../tb/ids.ts";
import type { VisitInput } from "../validation.ts";
import type { Actor, Row } from "./common.ts";

const VISIT_COLS = ["visit_date", "visit_type", "detail", "next_appt", "lat", "lng"] as const;

/** ผู้ป่วย index ของ visit (ใช้ผูกประวัติ) + ตรวจสิทธิ์ของ user unit */
async function checkTarget(db: Queryable, v: Pick<VisitInput, "patient_id" | "contact_id">, actor: Actor): Promise<string> {
  if (v.patient_id) {
    if (actor.role !== "admin") throw forbidden("บันทึกการรักษาของผู้ป่วยทำได้เฉพาะทีม รพ.");
    const [r] = await db.query<Row[]>("SELECT id FROM tb_patients WHERE id = ? AND deleted_at IS NULL", [v.patient_id]);
    if (!r[0]) throw badRequest("ไม่พบผู้ป่วย");
    return v.patient_id;
  }
  const [r] = await db.query<Row[]>("SELECT patient_id, unit_id FROM tb_contacts WHERE id = ? AND deleted_at IS NULL", [v.contact_id]);
  if (!r[0]) throw badRequest("ไม่พบผู้สัมผัส");
  if (actor.role !== "admin" && r[0].unit_id !== actor.unitId) throw forbidden("บันทึกได้เฉพาะผู้สัมผัสในเขตรับผิดชอบของหน่วยท่าน");
  return r[0].patient_id as string;
}

export async function createVisit(
  db: Queryable, input: VisitInput, actor: Actor, opts: { id?: string } = {},
): Promise<{ id: string; duplicate: boolean }> {
  if (input.client_uuid) {
    const [dup] = await db.query<Row[]>("SELECT id FROM tb_visits WHERE client_uuid = ?", [input.client_uuid]);
    if (dup[0]) return { id: dup[0].id as string, duplicate: true };
  }
  if (actor.id === null) throw badRequest("ต้องระบุผู้บันทึก");
  const patientId = await checkTarget(db, input, actor);
  const id = opts.id ?? newEntityId("V");
  await db.execute(
    `INSERT INTO tb_visits (id, patient_id, contact_id, visit_date, visit_type, detail, next_appt, lat, lng, client_uuid, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.patient_id ?? null, input.contact_id ?? null, input.visit_date, input.visit_type, input.detail,
      input.next_appt, input.lat ?? null, input.lng ?? null, input.client_uuid ?? null, actor.id, actor.id],
  );
  await writeAudit(db, {
    userId: actor.id, action: "add", entity: "visit", entityId: id, patientId,
    changes: diff(null, { ...input, ref: input.patient_id ?? input.contact_id }, [...VISIT_COLS, "ref"]), ip: actor.ip,
  });
  await enqueue(db, "visit", id);
  return { id, duplicate: false };
}

async function lockVisit(db: Queryable, id: string): Promise<Row> {
  const [rows] = await db.query<Row[]>(
    `SELECT v.*, u.unit_id AS by_unit_id FROM tb_visits v JOIN tb_users u ON u.id = v.created_by
      WHERE v.id = ? AND v.deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw notFound("ไม่พบบันทึก");
  return rows[0];
}

export async function updateVisit(db: Queryable, id: string, input: VisitInput, actor: Actor): Promise<{ id: string }> {
  const cur = await lockVisit(db, id);
  if (actor.role !== "admin" && cur.by_unit_id !== actor.unitId) throw forbidden("แก้ไขได้เฉพาะบันทึกของหน่วยท่าน");
  // แก้ได้แค่เนื้อหา — ย้ายไปผูกกับคนอื่นไม่ได้
  const patientId = await checkTarget(db, { patient_id: cur.patient_id as string | null, contact_id: cur.contact_id as string | null }, actor);
  const next = { ...input, lat: input.lat ?? cur.lat, lng: input.lng ?? cur.lng };
  const changes = diff(cur, next, VISIT_COLS);
  if (Object.keys(changes).length) {
    const cols = Object.keys(changes);
    await db.query(
      `UPDATE tb_visits SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_by = ? WHERE id = ?`,
      [...cols.map((c) => (next as Record<string, unknown>)[c] ?? null), actor.id, id],
    );
    await writeAudit(db, { userId: actor.id, action: "save", entity: "visit", entityId: id, patientId, changes, ip: actor.ip });
    await enqueue(db, "visit", id);
  }
  return { id };
}

export async function deleteVisit(db: Queryable, id: string, actor: Actor): Promise<void> {
  if (actor.role !== "admin") throw forbidden("เฉพาะทีม รพ. ลบบันทึกได้");
  const cur = await lockVisit(db, id);
  await db.execute("UPDATE tb_visits SET deleted_at = NOW(), updated_by = ? WHERE id = ?", [actor.id, id]);
  const [p] = await db.query<Row[]>("SELECT patient_id FROM tb_contacts WHERE id = ?", [cur.contact_id]);
  await writeAudit(db, {
    userId: actor.id, action: "delete", entity: "visit", entityId: id,
    patientId: (cur.patient_id as string | null) ?? (p[0]?.patient_id as string | undefined) ?? null,
    changes: { [`ลบบันทึก ${cur.visit_date} ${cur.visit_type}`]: [String(cur.detail ?? "").slice(0, 80), null] }, ip: actor.ip,
  });
  await enqueue(db, "visit", id);
}
