// lib/tb/tasks.ts
// งานที่ต้องทำ ("ต้องติดตาม") ของผู้สัมผัสและผู้ป่วย — ยึดตาม contactTasks / patientTasks ใน Index.html เดิม
//
// ผู้สัมผัส (ทำทีละขั้น):
//   A สอบสวน ภายใน 7 วันหลังผู้ป่วย index เริ่มยา
//   B คัดกรอง ภายใน 14 วันหลังวันสอบสวน (ผล "รอผล"/"ส่งตรวจเพิ่ม" = ยังไม่จบ)
//   C TPT เริ่มภายใน 14 วันหลังคัดกรอง แล้วนัดรายเดือนตามสูตร
//   D ติดตามนับจากวันคัดกรอง (ร่วมบ้าน 6/12/18/24 ด., ใกล้ชิด 12/24 ด.) เฉพาะผลคัดกรอง "ไม่ป่วย"
// ผู้ป่วย: ยังไม่มีผู้สัมผัส, AFB เดือน 2 → 5 → 6 แล้วสรุปผล (ทีละรายการ)

import {
  CONCLUDE_AFTER_MONTHS,
  CONTACTS_WITHIN_DAYS,
  CONTACT_FOLLOWUP_MONTHS,
  DEFAULT_TPT_MONTHS,
  INVESTIGATE_WITHIN_DAYS,
  OUTCOME_ONGOING,
  PATIENT_AFB_MONTHS,
  SCREEN_NEGATIVE,
  SCREEN_PENDING,
  SCREEN_WITHIN_DAYS,
  TPT_ELIGIBLE_YES,
  TPT_ONGOING_STATUS,
  TPT_REGIMEN_MONTHS,
  TPT_START_WITHIN_DAYS,
} from "./constants.ts";
import { isTB } from "./contacts.ts";
import { addDays, addMonths, diffDays, type IsoDate } from "./dates.ts";
import type { ContactRow, FollowupRow, PatientRow } from "./types.ts";

export type TaskStatus = "overdue" | "due_soon" | "upcoming" | "unscheduled";

export interface Task {
  /** ขั้น: A/B/C/D ของผู้สัมผัส, A/4/5 ของผู้ป่วย (ตามหมวดในฟอร์มเดิม) */
  step: "A" | "B" | "C" | "D" | "4" | "5";
  what: string;
  /** null = ยังคำนวณไม่ได้ (ไม่มีวันเริ่มยาของผู้ป่วย index) — หน้า "ต้องติดตาม" ไม่แสดง */
  due: IsoDate | null;
  status: TaskStatus;
}

/** ภายในกี่วันถือว่า "ใกล้ถึงกำหนด" (หน้า ต้องติดตาม: เกินกำหนด / ภายใน 7 วัน / 8–30 วัน) */
export const DUE_SOON_DAYS = 7;

export function taskStatus(due: IsoDate | null, today: IsoDate): TaskStatus {
  if (!due) return "unscheduled";
  const d = diffDays(today, due);
  if (d < 0) return "overdue";
  if (d <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

function task(step: Task["step"], what: string, due: IsoDate | null, today: IsoDate): Task {
  return { step, what, due, status: taskStatus(due, today) };
}

const sortByDue = (a: Task, b: Task) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1;

/** วันเริ่มนับของผู้ป่วย = วันเริ่มยา (ไม่มีใช้วันวินิจฉัย) */
export function patientStart(p: Pick<PatientRow, "start_date" | "diag_date"> | null | undefined): IsoDate | null {
  return p?.start_date || p?.diag_date || null;
}

/** จำนวนเดือนของสูตร TPT — ไม่รู้จักให้อ่านตัวเลขนำหน้า (เช่น "9H" → 9) ไม่งั้น 3 เดือน */
export function tptMonths(regimen: string | null | undefined): number {
  const r = regimen?.trim() ?? "";
  if (r in TPT_REGIMEN_MONTHS) return TPT_REGIMEN_MONTHS[r];
  const m = /^(\d{1,2})[A-Za-z]/.exec(r);
  return m ? Number(m[1]) : DEFAULT_TPT_MONTHS;
}

/** คัดกรองแล้ว (จบขั้น B) */
export function screened(c: Pick<ContactRow, "screen_result" | "new_patient_id" | "fu6_result" | "fu12_result" | "fu18_result" | "fu24_result">): boolean {
  return c.screen_result === SCREEN_NEGATIVE || isTB(c);
}

type ContactTaskFields = Pick<
  ContactRow,
  | "contact_type" | "invest_date" | "screen_date" | "cxr_date" | "screen_result" | "new_patient_id"
  | "tpt_eligible" | "tpt_regimen" | "tpt_start" | "tpt_status"
  | "fu6_date" | "fu6_result" | "fu12_date" | "fu12_result" | "fu18_date" | "fu18_result" | "fu24_date" | "fu24_result"
>;

export interface ContactTaskContext {
  /** patientStart() ของผู้ป่วย index */
  indexStart: IsoDate | null;
  today: IsoDate;
}

/** งานถัดไปของผู้สัมผัส (ว่าง = ป่วยเป็น TB แล้ว หรือครบ 2 ปี) เรียงตามกำหนด */
export function contactTasks(c: ContactTaskFields, ctx: ContactTaskContext): Task[] {
  const { indexStart, today } = ctx;
  if (isTB(c)) return [];

  if (!c.invest_date) {
    return [task("A", "สอบสวนผู้สัมผัส", indexStart && addDays(indexStart, INVESTIGATE_WITHIN_DAYS), today)];
  }

  if (!c.screen_result || (SCREEN_PENDING as readonly string[]).includes(c.screen_result)) {
    const what = c.screen_result === "ส่งตรวจเพิ่ม" ? "รอผลตรวจเพิ่ม" : "คัดกรอง ซักอาการ + CXR";
    return [task("B", what, addDays(c.invest_date, SCREEN_WITHIN_DAYS), today)];
  }

  const out: Task[] = [];

  if (c.tpt_eligible === TPT_ELIGIBLE_YES && !c.tpt_start) {
    out.push(task("C", "เริ่ม TPT", addDays(c.screen_date || c.invest_date, TPT_START_WITHIN_DAYS), today));
  }
  if (c.tpt_start && (!c.tpt_status || c.tpt_status === TPT_ONGOING_STATUS)) {
    // นัดถัดไป = เดือนที่ k แรกที่ยังไม่ผ่าน; เลยครบสูตรแล้ว → ให้บันทึกสถานะ
    const months = tptMonths(c.tpt_regimen);
    let next: IsoDate | null = null;
    for (let k = 1; k <= months; k++) {
      const d = addMonths(c.tpt_start, k);
      if (d >= today) { next = d; break; }
    }
    out.push(next
      ? task("C", "นัด TPT รายเดือน", next, today)
      : task("C", "ครบระยะ TPT – บันทึกสถานะ", addMonths(c.tpt_start, months), today));
  }

  const base = c.screen_date || c.cxr_date || c.invest_date;
  const n = CONTACT_FOLLOWUP_MONTHS[c.contact_type].find((m) => !c[`fu${m}_date` as const]);
  if (n && c.screen_result === SCREEN_NEGATIVE) {
    out.push(task("D", `ติดตาม ${n} เดือน (ซักอาการ + CXR)`, addMonths(base, n), today));
  }

  return out.sort(sortByDue);
}

type PatientTaskFields = Pick<PatientRow, "start_date" | "diag_date" | "outcome">;

export interface PatientTaskContext {
  contactCount: number;
  followups: readonly Pick<FollowupRow, "month_no" | "test" | "result">[];
  today: IsoDate;
}

export function isConcluded(outcome: string | null | undefined): boolean {
  const o = outcome?.trim();
  return !!o && o !== OUTCOME_ONGOING;
}

/** ผล AFB เดือนนั้นจาก tb_treatment_followups (เดิมคือช่อง m2Afb/m5Afb/m6Afb) */
export function afbResult(followups: PatientTaskContext["followups"], month: number): string | null {
  return followups.find((f) => f.month_no === month && f.test === "AFB" && f.result?.trim())?.result ?? null;
}

export function patientTasks(p: PatientTaskFields, ctx: PatientTaskContext): Task[] {
  if (isConcluded(p.outcome)) return [];
  const s = patientStart(p);
  if (!s) return [];
  const { today } = ctx;
  const out: Task[] = [];

  if (ctx.contactCount === 0) {
    out.push(task("A", "ระบุ/สอบสวนผู้สัมผัส", addDays(s, CONTACTS_WITHIN_DAYS), today));
  }

  const nextAfb = PATIENT_AFB_MONTHS.find((m) => !afbResult(ctx.followups, m));
  out.push(nextAfb
    ? task("4", `AFB เดือน ${nextAfb}`, addMonths(s, nextAfb), today)
    : task("5", "สรุปผลการรักษา", addMonths(s, CONCLUDE_AFTER_MONTHS), today));
  return out;
}
