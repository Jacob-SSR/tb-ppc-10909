// lib/worker/hosxpAppointments.ts — อัปเดตนัดที่ดึงจาก HOSxP ทุกเช้า (ก่อนแจ้งนัด 07:00)
//   มี visit ผูกกับนัด → มาตามนัด · สถานะไม่ใช่นัดปกติ / ถูกลบใน HOSxP → ยกเลิก · วัน-เวลาเปลี่ยน → เลื่อนตาม
// อ่าน HOSxP ไม่ได้ = ไม่แตะอะไร (ไม่ยกเลิกนัดจากข้อมูลที่ไม่แน่ใจ — แบบเดียวกับ plubplachai-alert)
import { type Queryable, writeAudit } from "../audit.ts";
import { readHosxpAppointments, type HosxpAppointment } from "../hosxp.ts";
import type { Row } from "../repo/common.ts";
import { APPT_STATUS_LABEL } from "../tb/appointments.ts";

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
