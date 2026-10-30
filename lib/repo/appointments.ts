// lib/repo/appointments.ts — นัดหมาย (tb_appointments): เพิ่ม / แก้ (เลื่อน, มาตามนัด, ยกเลิก) / ลบ
// สิทธิ์ตามกติกาบันทึกรายครั้ง (§5.1):
//   admin = ทุกราย · user unit = เฉพาะผู้สัมผัสในเขตตัวเอง (นัดของผู้ป่วยไม่ได้) · ลบ = admin เท่านั้น (unit ใช้ "ยกเลิก")
// ผูกกับบันทึกรายครั้ง: บันทึกใหม่ → นัดที่ถึงวันแล้วของรายนั้นถือว่า "มาตามนัด", next_appt → นัดใหม่ (source='visit')
// นัดจาก HOSxP: upsert ตาม hosxp_oapp_id (ดึงซ้ำไม่เพิ่มซ้ำ)
import { diff, type Queryable, writeAudit } from "../audit.ts";
import { badRequest, forbidden } from "../errors.ts";
import { APPT_STATUS_LABEL } from "../tb/appointments.ts";
import { newEntityId } from "../tb/ids.ts";
import type { AppointmentInput } from "../validation.ts";
import { type Actor, assertVersion, lockRow, type Row } from "./common.ts";

const COLS = ["appt_date", "appt_time", "purpose", "place", "doctor_name", "note", "status", "hosxp_status", "appt_time_end", "department", "contact_point", "instructions", "telemed"] as const;

/** ผู้ป่วย index ของนัด (ผูกประวัติ) + ตรวจสิทธิ์ของ user unit */
async function checkTarget(db: Queryable, ref: { patient_id?: string | null; contact_id?: string | null }, actor: Actor): Promise<string> {
  if (ref.patient_id) {
    if (actor.role !== "admin") throw forbidden("นัดของผู้ป่วยทำได้เฉพาะทีม รพ.");
    const [r] = await db.query<Row[]>("SELECT id FROM tb_patients WHERE id = ? AND deleted_at IS NULL", [ref.patient_id]);
    if (!r[0]) throw badRequest("ไม่พบผู้ป่วย");
    return ref.patient_id;
  }
  const [r] = await db.query<Row[]>("SELECT patient_id, unit_id FROM tb_contacts WHERE id = ? AND deleted_at IS NULL", [ref.contact_id]);
  if (!r[0]) throw badRequest("ไม่พบผู้สัมผัส");
  if (actor.role !== "admin" && r[0].unit_id !== actor.unitId) throw forbidden("นัดได้เฉพาะผู้สัมผัสในเขตรับผิดชอบของหน่วยท่าน");
  return r[0].patient_id as string;
}

/** ค่าที่อ่านง่ายในประวัติการแก้ไข (status เป็นภาษาไทย) */
function readable(c: Record<string, [unknown, unknown]>) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k, [a, b]] of Object.entries(c)) {
    const t = (v: unknown) => (k === "status" && v ? APPT_STATUS_LABEL[v as keyof typeof APPT_STATUS_LABEL] ?? v : v);
    out[k] = [t(a), t(b)];
  }
  return out;
}

export async function createAppointment(
  db: Queryable, input: AppointmentInput, actor: Actor, opts: { source?: "manual" | "visit" | "hosxp"; visitId?: string } = {},
): Promise<{ id: string; existing: boolean }> {
  const patientId = await checkTarget(db, input, actor);
  // นัดจาก HOSxP: มีอยู่แล้ว (ดึงซ้ำ) → อัปเดตรายการเดิมแทน
  if (input.hosxp_oapp_id) {
    if (actor.role !== "admin") throw forbidden("ดึงนัดจาก HOSxP ได้เฉพาะทีม รพ.");
    const [dup] = await db.query<Row[]>("SELECT id, version, deleted_at FROM tb_appointments WHERE hosxp_oapp_id = ?", [input.hosxp_oapp_id]);
    if (dup[0] && !dup[0].deleted_at) {
      await updateAppointment(db, dup[0].id as string, undefined, input, actor);
      return { id: dup[0].id as string, existing: true };
    }
    if (dup[0]) await db.execute("UPDATE tb_appointments SET hosxp_oapp_id = NULL WHERE id = ?", [dup[0].id]); // ลบไปแล้ว → นำเข้าใหม่ได้
  }
  const id = newEntityId("A");
  const source = opts.source ?? (input.hosxp_oapp_id ? "hosxp" : "manual");
  await db.execute(
    `INSERT INTO tb_appointments (id, patient_id, contact_id, appt_date, appt_time, purpose, place, doctor_name, note, status,
                                  source, visit_id, hosxp_oapp_id, hosxp_status, created_by, updated_by, appt_time_end, department, contact_point, instructions, telemed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.patient_id ?? null, input.contact_id ?? null, input.appt_date, input.appt_time, input.purpose, input.place,
      input.doctor_name, input.note, input.status, source, opts.visitId ?? null, input.hosxp_oapp_id ?? null,
      input.hosxp_status ?? null, actor.id, actor.id, input.appt_time_end ?? null, input.department ?? null, input.contact_point ?? null, input.instructions ?? null, input.telemed ? 1 : 0],
  );
  await writeAudit(db, {
    userId: actor.id, action: "add", entity: "appointment", entityId: id, patientId,
    changes: readable(diff(null, { ...input, ref: input.patient_id ?? input.contact_id }, [...COLS, "ref"])), ip: actor.ip,
  });
  return { id, existing: false };
}

export async function updateAppointment(
  db: Queryable, id: string, version: number | undefined, input: AppointmentInput, actor: Actor,
): Promise<{ id: string; version: number }> {
  const cur = await lockRow(db, "tb_appointments", id, "นัด");
  assertVersion(cur, version);
  // แก้ได้แค่เนื้อหา — ย้ายไปเป็นนัดของคนอื่นไม่ได้
  const patientId = await checkTarget(db, { patient_id: cur.patient_id as string | null, contact_id: cur.contact_id as string | null }, actor);
  const next: Record<string, unknown> = { ...input, hosxp_status: input.hosxp_status ?? cur.hosxp_status };
  // Older clients/imports omit new fields: preserve saved details.
  for (const k of ["appt_time_end", "department", "contact_point", "instructions", "telemed"] as const) {
    next[k] = input[k] === undefined ? cur[k] : k === "telemed" ? (input[k] ? 1 : 0) : input[k];
  }
  const changes = diff(cur, next, COLS);
  if (!Object.keys(changes).length) return { id, version: Number(cur.version) };
  const cols = Object.keys(changes);
  await db.query(
    `UPDATE tb_appointments SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_by = ?, version = version + 1 WHERE id = ?`,
    [...cols.map((c) => next[c] ?? null), actor.id, id],
  );
  await writeAudit(db, { userId: actor.id, action: "save", entity: "appointment", entityId: id, patientId, changes: readable(changes), ip: actor.ip });
  return { id, version: Number(cur.version) + 1 };
}

export async function deleteAppointment(db: Queryable, id: string, version: number | undefined, actor: Actor): Promise<void> {
  if (actor.role !== "admin") throw forbidden("เฉพาะทีม รพ. ลบนัดได้ — หน่วยบริการใช้ \"ยกเลิกนัด\" แทน");
  const cur = await lockRow(db, "tb_appointments", id, "นัด");
  assertVersion(cur, version);
  const patientId = await checkTarget(db, { patient_id: cur.patient_id as string | null, contact_id: cur.contact_id as string | null }, actor);
  await db.execute("UPDATE tb_appointments SET deleted_at = NOW(), updated_by = ?, version = version + 1 WHERE id = ?", [actor.id, id]);
  await writeAudit(db, {
    userId: actor.id, action: "delete", entity: "appointment", entityId: id, patientId,
    changes: { [`ลบนัด ${cur.appt_date}`]: [cur.purpose, null] }, ip: actor.ip,
  });
}

// ── ผูกกับบันทึกรายครั้ง (เรียกจาก lib/repo/visits.ts ใน transaction เดียวกัน) ─────────

type VisitLike = { id: string; patient_id: string | null; contact_id: string | null; visit_date: string; visit_type: string; next_appt: string | null };

/** บันทึกรายครั้งใหม่: นัดที่ถึงวันแล้ว (≤ วันที่บันทึก) ของรายนั้น → มาตามนัด */
export async function markAttended(db: Queryable, v: VisitLike, actor: Actor): Promise<void> {
  const refCol = v.patient_id ? "patient_id" : "contact_id";
  const [rows] = await db.query<Row[]>(
    `SELECT id, appt_date FROM tb_appointments
      WHERE ${refCol} = ? AND status = 'scheduled' AND deleted_at IS NULL AND appt_date <= ? AND (visit_id IS NULL OR visit_id <> ?)
      FOR UPDATE`,
    [v.patient_id ?? v.contact_id, v.visit_date, v.id],
  );
  for (const r of rows) {
    await db.execute("UPDATE tb_appointments SET status = 'done', updated_by = ?, version = version + 1 WHERE id = ?", [actor.id, r.id]);
    await writeAudit(db, {
      userId: actor.id, action: "save", entity: "appointment", entityId: r.id as string, patientId: v.patient_id,
      changes: { status: [APPT_STATUS_LABEL.scheduled, `${APPT_STATUS_LABEL.done} (บันทึก ${v.visit_date})`] }, ip: actor.ip,
    });
  }
}

/** next_appt ของบันทึก → นัด 1 รายการผูกกับบันทึกนั้น (สร้าง / เลื่อนตาม / ลบเมื่อเอาวันนัดออก) */
export async function syncVisitAppointment(db: Queryable, v: VisitLike, actor: Actor): Promise<void> {
  const [rows] = await db.query<Row[]>("SELECT id, version, status, appt_date FROM tb_appointments WHERE visit_id = ? AND deleted_at IS NULL FOR UPDATE", [v.id]);
  const cur = rows[0];
  if (!v.next_appt) {
    if (cur && cur.status === "scheduled") {
      await db.execute("UPDATE tb_appointments SET deleted_at = NOW(), updated_by = ? WHERE id = ?", [actor.id, cur.id]);
      await writeAudit(db, { userId: actor.id, action: "delete", entity: "appointment", entityId: cur.id as string, patientId: v.patient_id,
        changes: { [`ลบนัด ${cur.appt_date}`]: ["เอาวันนัดออกจากบันทึกรายครั้ง", null] }, ip: actor.ip });
    }
    return;
  }
  if (!cur) {
    const [old] = await db.query<Row[]>("SELECT id FROM tb_appointments WHERE visit_id = ?", [v.id]); // เคยลบไปแล้ว — ปลดการผูกเดิม
    if (old[0]) await db.execute("UPDATE tb_appointments SET visit_id = NULL WHERE id = ?", [old[0].id]);
    await createAppointment(db, {
      patient_id: v.patient_id, contact_id: v.contact_id, appt_date: v.next_appt, appt_time: null, purpose: v.visit_type.slice(0, 100),
      place: null, doctor_name: null, note: null, status: "scheduled",
    }, actor, { source: "visit", visitId: v.id });
    return;
  }
  if (cur.status === "scheduled" && cur.appt_date !== v.next_appt) {
    await db.execute("UPDATE tb_appointments SET appt_date = ?, updated_by = ?, version = version + 1 WHERE id = ?", [v.next_appt, actor.id, cur.id]);
    await writeAudit(db, { userId: actor.id, action: "save", entity: "appointment", entityId: cur.id as string, patientId: v.patient_id,
      changes: { appt_date: [cur.appt_date, v.next_appt] }, ip: actor.ip });
  }
}

/** ลบบันทึกรายครั้ง → นัดที่ยังค้างจากบันทึกนั้นถูกลบด้วย */
export async function dropVisitAppointment(db: Queryable, visitId: string, patientId: string | null, actor: Actor): Promise<void> {
  const [rows] = await db.query<Row[]>("SELECT id, appt_date FROM tb_appointments WHERE visit_id = ? AND status = 'scheduled' AND deleted_at IS NULL", [visitId]);
  for (const r of rows) {
    await db.execute("UPDATE tb_appointments SET deleted_at = NOW(), updated_by = ? WHERE id = ?", [actor.id, r.id]);
    await writeAudit(db, { userId: actor.id, action: "delete", entity: "appointment", entityId: r.id as string, patientId,
      changes: { [`ลบนัด ${r.appt_date}`]: ["ลบบันทึกรายครั้งที่สร้างนัดนี้", null] }, ip: actor.ip });
  }
}
