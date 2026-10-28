// lib/worker/hosxpAppointments.ts — นัดจาก HOSxP
//   syncClinicAppointments: ดึงนัดคลินิก household / close contact เข้าระบบอัตโนมัติ (ทุกชั่วโมง)
//   refreshHosxpAppointments: อัปเดตนัดที่ดึงมาแล้ว ทุกเช้า 06:00 (ก่อนแจ้งนัด 07:00)
//   มี visit ผูกกับนัด → มาตามนัด · สถานะไม่ใช่นัดปกติ / ถูกลบใน HOSxP → ยกเลิก · วัน-เวลาเปลี่ยน → เลื่อนตาม
// อ่าน HOSxP ไม่ได้ = ไม่แตะอะไร (ไม่ยกเลิกนัดจากข้อมูลที่ไม่แน่ใจ — แบบเดียวกับ plubplachai-alert)
import { type Queryable, writeAudit } from "../audit.ts";
import type { Pool } from "mysql2/promise";
import { findClinicAppointments, readHosxpAppointments, type HosxpAppointment } from "../hosxp.ts";
import { createAppointment } from "../repo/appointments.ts";
import { type Row, SYSTEM_ACTOR } from "../repo/common.ts";
import { APPT_STATUS_LABEL } from "../tb/appointments.ts";
import { addDays } from "../tb/dates.ts";
import { appointmentInput } from "../validation.ts";

export async function refreshHosxpAppointments(
  db: Queryable, read: (ids: string[]) => Promise<Map<string, HosxpAppointment>> = readHosxpAppointments,
): Promise<{ checked: number; updated: number }> {
  const [rows] = await db.query<Row[]>(
    `SELECT id, patient_id, contact_id, appt_date, appt_time, hosxp_oapp_id, hosxp_status FROM tb_appointments
      WHERE deleted_at IS NULL AND status = 'scheduled' AND hosxp_oapp_id IS NOT NULL AND appt_date >= CURDATE() - INTERVAL 60 DAY`,
  );
  if (!rows.length) return { checked: 0, updated: 0 };
  const src = await read(rows.map((r) => String(r.hosxp_oapp_id)));
  let updated = 0;
  for (const r of rows) {
    const h = src.get(String(r.hosxp_oapp_id));
    const set: Record<string, unknown> = {};
    if (!h) set.status = "cancelled";
    else if (h.came) set.status = "done";
    else if (!h.active) set.status = "cancelled";
    else {
      if (h.date !== r.appt_date) set.appt_date = h.date;
      if ((h.time ?? null) !== (r.appt_time ?? null)) set.appt_time = h.time;
    }
    if (h && (h.status ?? null) !== (r.hosxp_status ?? null)) set.hosxp_status = h.status;
    const cols = Object.keys(set);
    if (!cols.length) continue;
    await db.query(
      `UPDATE tb_appointments SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_by = NULL, version = version + 1 WHERE id = ?`,
      [...cols.map((c) => set[c]), r.id],
    );
    const why = !h ? " (ถูกลบใน HOSxP)" : "";
    await writeAudit(db, {
      userId: null, action: "save", entity: "appointment", entityId: r.id as string, patientId: (r.patient_id as string | null) ?? null,
      changes: Object.fromEntries(cols.filter((c) => c !== "hosxp_status").map((c) => [
        c, c === "status" ? [APPT_STATUS_LABEL.scheduled, `${APPT_STATUS_LABEL[set.status as keyof typeof APPT_STATUS_LABEL]} ตาม HOSxP${why}`] : [r[c], set[c]],
      ])),
    });
    updated++;
  }
  return { checked: rows.length, updated };
}

type ClinicAppt = HosxpAppointment & { hn: string; cid: string };

/**
 * ดึงนัดคลินิก household / close contact จาก HOSxP เข้าระบบอัตโนมัติ (ทุกชั่วโมง)
 *   จับคู่: ผู้สัมผัสตาม HN → ผู้สัมผัสตามเลขบัตร → ผู้ป่วยตาม HN (รายที่ยังรักษาอยู่ล่าสุด) — ไม่พบ = ข้าม (นับไว้)
 *   นัดที่ดึงแล้วไม่แตะ (สถานะ/วันเลื่อนอัปเดตโดย refreshHosxpAppointments) — ไม่ทับที่คนบันทึกเองในระบบ
 *   นัดที่ยกเลิกใน HOSxP และยังไม่เคยดึง = ไม่ต้องดึง
 */
export async function syncClinicAppointments(
  db: Queryable, today: string,
  read: (from: string, to: string) => Promise<ClinicAppt[]> = findClinicAppointments,
): Promise<{ read: number; added: number; unmatched: number }> {
  const list = await read(addDays(today, -7), addDays(today, 365));
  if (!list.length) return { read: 0, added: 0, unmatched: 0 };
  const ids = list.map((a) => a.oapp_id);
  const [have] = await db.query<Row[]>(
    `SELECT hosxp_oapp_id FROM tb_appointments WHERE hosxp_oapp_id IN (${ids.map(() => "?").join(",")})`, ids,
  );
  const known = new Set(have.map((r) => String(r.hosxp_oapp_id)));
  const [contacts] = await db.query<Row[]>("SELECT id, hn, cid FROM tb_contacts WHERE deleted_at IS NULL");
  const [patients] = await db.query<Row[]>(
    "SELECT id, hn FROM tb_patients WHERE deleted_at IS NULL AND hn IS NOT NULL ORDER BY (outcome = 'กำลังรักษา') DESC, start_date DESC",
  );
  const cByHn = new Map<string, string>();
  const cByCid = new Map<string, string>();
  for (const c of contacts) {
    if (c.hn) cByHn.set(String(c.hn).trim(), String(c.id));
    if (c.cid) cByCid.set(String(c.cid), String(c.id));
  }
  const pByHn = new Map<string, string>();
  for (const p of patients) if (!pByHn.has(String(p.hn).trim())) pByHn.set(String(p.hn).trim(), String(p.id));

  let added = 0;
  let unmatched = 0;
  for (const a of list) {
    if (known.has(a.oapp_id) || (!a.active && !a.came)) continue;
    const contactId = cByHn.get(a.hn) ?? (a.cid ? cByCid.get(a.cid) : undefined);
    const patientId = contactId ? undefined : pByHn.get(a.hn);
    if (!contactId && !patientId) {
      unmatched++;
      continue;
    }
    await withTx(db, (conn) => createAppointment(conn, appointmentInput.parse({
      patient_id: patientId ?? null, contact_id: contactId ?? null, appt_date: a.date, appt_time: a.time,
      purpose: (a.cause || a.clinic || "นัด HOSxP").slice(0, 100), place: [a.clinic, a.place].filter(Boolean).join(" · ").slice(0, 150) || null,
      doctor_name: a.doctor || null, note: a.note || null, status: a.came ? "done" : "scheduled", hosxp_oapp_id: a.oapp_id, hosxp_status: a.status,
    }), SYSTEM_ACTOR));
    added++;
  }
  return { read: list.length, added, unmatched };
}

/** db เป็น pool → ทำทีละรายการใน transaction ของตัวเอง (รายการหนึ่งพังไม่ลากรายการอื่น) */
async function withTx<T>(db: Queryable, fn: (c: Queryable) => Promise<T>): Promise<T> {
  const pool = db as Partial<Pool>;
  if (typeof pool.getConnection !== "function") return fn(db);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
