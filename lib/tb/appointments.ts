// lib/tb/appointments.ts
// นัดหมาย = "วันนัดครั้งถัดไป" ของบันทึกครั้งล่าสุดของแต่ละราย (appointments_ / apptList เดิม)
// มาตามนัดแล้วบันทึกครั้งใหม่ → นัดย้ายตามบันทึกใหม่เอง; บันทึกล่าสุดไม่มีวันนัด = ไม่มีนัดค้าง
// ใช้ทั้งหน้า "นัดหมาย" และแจ้งเตือน 07:00 (ขาดนัด / วันนี้ / พรุ่งนี้)

import { addDays, type IsoDate } from "./dates.ts";
import type { VisitRow } from "./types.ts";

export interface Appointment {
  kind: "P" | "C";
  refId: string;
  appt: IsoDate;
  last: Pick<VisitRow, "id" | "visit_date" | "visit_type" | "detail">;
}

type VisitFields = Pick<VisitRow, "id" | "patient_id" | "contact_id" | "visit_date" | "visit_type" | "detail" | "next_appt" | "updated_at">;

/**
 * นัดค้างของแต่ละราย จาก visit ที่ยังไม่ถูกลบ
 * isActivePatient: ผู้ป่วยที่สรุปผลแล้ว (outcome ≠ กำลังรักษา) ไม่ต้องแสดงนัด
 */
export function latestAppointments(
  visits: readonly VisitFields[],
  isActivePatient: (patientId: string) => boolean = () => true,
): Appointment[] {
  const latest = new Map<string, VisitFields>();
  for (const v of visits) {
    const ref = v.patient_id ?? v.contact_id;
    if (!ref) continue;
    const cur = latest.get(ref);
    if (!cur || v.visit_date > cur.visit_date || (v.visit_date === cur.visit_date && v.updated_at > cur.updated_at)) {
      latest.set(ref, v);
    }
  }
  const out: Appointment[] = [];
  for (const [refId, v] of latest) {
    if (!v.next_appt) continue;
    const kind = v.patient_id ? "P" : "C";
    if (kind === "P" && !isActivePatient(refId)) continue;
    out.push({
      kind,
      refId,
      appt: v.next_appt,
      last: { id: v.id, visit_date: v.visit_date, visit_type: v.visit_type, detail: v.detail },
    });
  }
  return out.sort((a, b) => (a.appt < b.appt ? -1 : a.appt > b.appt ? 1 : 0));
}

export interface AppointmentGroups<T extends { appt: IsoDate }> {
  missed: T[]; // เลยวันนัดแล้วยังไม่มีบันทึกการมา
  today: T[];
  tomorrow: T[];
  week: T[]; // หลังพรุ่งนี้ ถึง 7 วัน
  later: T[];
}

export function groupAppointments<T extends { appt: IsoDate }>(list: readonly T[], today: IsoDate): AppointmentGroups<T> {
  const tmr = addDays(today, 1);
  const wk = addDays(today, 7);
  return {
    missed: list.filter((a) => a.appt < today),
    today: list.filter((a) => a.appt === today),
    tomorrow: list.filter((a) => a.appt === tmr),
    week: list.filter((a) => a.appt > tmr && a.appt <= wk),
    later: list.filter((a) => a.appt > wk),
  };
}
