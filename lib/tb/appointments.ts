// lib/tb/appointments.ts — นัดหมาย (tb_appointments) ส่วนที่เป็นตรรกะล้วน ใช้ทั้งหน้าเว็บและแจ้งเตือน 07:00
//   นัดค้าง = status 'scheduled' (เลยวันแล้วยังไม่บันทึกว่ามา = ขาดนัด)
//   บันทึกรายครั้งใหม่ → นัดเดิมที่ถึงวันแล้วถือว่ามาตามนัด, next_appt → นัดใหม่ (ทำใน lib/repo/appointments.ts)
//   ไม่แสดงนัดของผู้ป่วยที่สรุปผลการรักษาแล้ว (กติกาเดิม)

import { addDays, type IsoDate } from "./dates.ts";

export const APPT_STATUS_LABEL = {
  scheduled: "นัดไว้",
  done: "มาตามนัด",
  missed: "ขาดนัด",
  cancelled: "ยกเลิก",
} as const;
export type ApptStatus = keyof typeof APPT_STATUS_LABEL;

export const APPT_SOURCE_LABEL = { manual: "คีย์เอง", visit: "จากบันทึกรายครั้ง", hosxp: "HOSxP" } as const;
export type ApptSource = keyof typeof APPT_SOURCE_LABEL;

/** เรื่องที่นัดที่ใช้บ่อย (พิมพ์อย่างอื่นเองได้) */
export const APPT_PURPOSES = [
  "รับยา / ติดตามอาการ",
  "ตรวจเสมหะ (AFB)",
  "เอกซเรย์ปอด (CXR)",
  "เจาะเลือด / ผล LFT",
  "พบแพทย์",
  "DOT / เยี่ยมบ้าน",
  "รับยา TPT",
  "คัดกรองผู้สัมผัส (ซักอาการ + CXR)",
  "ติดตามผู้สัมผัส (6/12/18/24 เดือน)",
] as const;

export interface ApptRow {
  id: string;
  patient_id: string | null;
  contact_id: string | null;
  appt_date: IsoDate;
  appt_time: string | null;
  purpose: string;
  place: string | null;
  status: ApptStatus;
}

export interface Appointment<R extends ApptRow = ApptRow> {
  kind: "P" | "C";
  refId: string;
  appt: IsoDate;
  row: R;
}

/** นัดที่ยังค้าง (scheduled) เรียงตามวัน-เวลา — isActivePatient: ผู้ป่วยที่สรุปผลแล้วไม่ต้องแสดง */
export function pendingAppointments<R extends ApptRow>(
  rows: readonly R[],
  isActivePatient: (patientId: string) => boolean = () => true,
): Appointment<R>[] {
  return rows
    .filter((r) => r.status === "scheduled" && (!r.patient_id || isActivePatient(r.patient_id)))
    .map((r) => ({ kind: r.patient_id ? ("P" as const) : ("C" as const), refId: (r.patient_id ?? r.contact_id)!, appt: r.appt_date, row: r }))
    .sort((a, b) => `${a.appt} ${a.row.appt_time ?? ""}`.localeCompare(`${b.appt} ${b.row.appt_time ?? ""}`));
}

/** ข้อความสั้นของนัด: "08:30 · ตรวจเสมหะ (AFB) · คลินิกวัณโรค" */
export function apptSummary(r: Pick<ApptRow, "appt_time" | "purpose" | "place">): string {
  return [r.appt_time?.slice(0, 5), r.purpose, r.place].filter(Boolean).join(" · ");
}

export interface AppointmentGroups<T extends { appt: IsoDate }> {
  missed: T[]; // เลยวันนัดแล้วยังไม่ได้บันทึกว่ามา
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
