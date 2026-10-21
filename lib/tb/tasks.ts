// lib/tb/tasks.ts
// งานที่ต้องทำ ("ต้องติดตาม") ของผู้สัมผัสและผู้ป่วย — คืนเฉพาะงานที่ยังไม่เสร็จ
//
// ผู้สัมผัส: A สอบสวน ≤7 วัน → B คัดกรอง ≤14 วัน → C TPT นัดรายเดือนตามสูตร
//           → D ติดตามครบ 2 ปี (ร่วมบ้าน 6/12/18/24 ด., ใกล้ชิด 12/24 ด.)
// ผู้ป่วย:   ยังไม่มีผู้สัมผัส, AFB เดือน 2/5/6, สรุปผลการรักษา

import {
  CONTACTS_WITHIN_DAYS,
  CONTACT_FOLLOWUP_MONTHS,
  DEFAULT_REGIMEN_MONTHS,
  INVESTIGATE_WITHIN_DAYS,
  OUTCOME_ONGOING,
  PATIENT_AFB_MONTHS,
  SCREEN_WITHIN_DAYS,
  TPT_ENDED_STATUSES,
  TPT_REGIMENS,
} from "./constants.ts";
import { isTB } from "./contacts.ts";
import { addDays, addMonths, diffDays, type IsoDate } from "./dates.ts";
import type { ContactRow, FollowupRow, PatientRow } from "./types.ts";

export type TaskStatus = "overdue" | "due_soon" | "upcoming" | "unscheduled";

export interface Task {
  /** รหัสงานคงที่ ใช้เป็น key ใน UI / แจ้งเตือน เช่น "A", "C:tpt-2", "D:12", "P:afb-5" */
  key: string;
  step: "A" | "B" | "C" | "D" | "TB" | "P";
  label: string;
  due: IsoDate | null;
  status: TaskStatus;
}

/** ภายในกี่วันถือว่า "ใกล้ถึงกำหนด" */
export const DUE_SOON_DAYS = 7;

export function taskStatus(due: IsoDate | null, today: IsoDate): TaskStatus {
  if (!due) return "unscheduled";
  const d = diffDays(today, due);
  if (d < 0) return "overdue";
  if (d <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

function task(key: string, step: Task["step"], label: string, due: IsoDate | null, today: IsoDate): Task {
  return { key, step, label, due, status: taskStatus(due, today) };
}

/** จำนวนเดือนของสูตร TPT — ไม่รู้จักสูตรให้อ่านตัวเลขนำหน้า (เช่น "3HP" → 3) */
export function tptMonths(regimen: string | null | undefined): number | null {
  const r = regimen?.trim();
  if (!r) return null;
  if (r in TPT_REGIMENS) return TPT_REGIMENS[r];
  const m = /^(\d{1,2})/.exec(r);
  return m ? Number(m[1]) : null;
}

/**
 * จำนวนเดือนของสูตรยารักษา TB จากข้อความในทะเบียน
 *   "2IRZE + 4IR" → 6, "2IRZE/10IR" → 12, "2IRZE/4-7IR" → 9 (ช่วงใช้ค่ามาก), "9HZE" → 9
 *   มีหลายสูตร (คั่นด้วย ,) ใช้สูตรสุดท้าย = สูตรที่เปลี่ยนมาล่าสุด
 */
export function regimenMonths(regimen: string | null | undefined): number {
  const last = regimen?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  if (!last) return DEFAULT_REGIMEN_MONTHS;
  let total = 0;
  for (const phase of last.split(/[+/]/)) {
    const m = /^\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?/.exec(phase);
    if (m) total += Number(m[2] ?? m[1]);
  }
  return total > 0 ? total : DEFAULT_REGIMEN_MONTHS;
}

type ContactTaskFields = Pick<
  ContactRow,
  | "contact_type" | "investigate_date" | "screen_date" | "screen_result" | "new_patient_id"
  | "tb_treat_place" | "tpt_eligible" | "tpt_regimen" | "tpt_start_date" | "tpt_end_date"
  | "tpt_status" | "fu6_date" | "fu6_result" | "fu12_date" | "fu12_result" | "fu18_date"
  | "fu18_result" | "fu24_date" | "fu24_result"
>;

export interface ContactTaskContext {
  /** วันเริ่มยาของผู้ป่วย index — ใช้นับ A/B/D */
  indexStartDate: IsoDate | null;
  today: IsoDate;
  /** วันที่ของ visit ประเภท TPT หลังเริ่มยา (ใช้หานัดเดือนถัดไป) */
  tptVisitDates?: readonly IsoDate[];
}

export function contactTasks(c: ContactTaskFields, ctx: ContactTaskContext): Task[] {
  const { indexStartDate: start, today } = ctx;

  // ป่วยแล้ว → ไม่ต้องทำ TPT/ติดตามต่อ เหลือแค่ต้องรู้ว่ารักษาที่ไหน
  if (isTB(c)) {
    return c.new_patient_id || c.tb_treat_place?.trim()
      ? []
      : [task("TB", "TB", "ป่วยเป็นวัณโรค: ลงทะเบียนผู้ป่วย หรือระบุสถานที่รักษา", today, today)];
  }

  const out: Task[] = [];

  if (!c.investigate_date) {
    out.push(task("A", "A", `สอบสวนผู้สัมผัส (ภายใน ${INVESTIGATE_WITHIN_DAYS} วัน)`,
      start && addDays(start, INVESTIGATE_WITHIN_DAYS), today));
  }

  if (!c.screen_date) {
    out.push(task("B", "B", `คัดกรอง (ภายใน ${SCREEN_WITHIN_DAYS} วัน)`,
      start && addDays(start, SCREEN_WITHIN_DAYS), today));
    // ยังไม่คัดกรอง → ยังไม่รู้ว่าเข้าเกณฑ์ TPT ไหม ข้าม C ไปก่อน
  } else {
    out.push(...tptTasks(c, ctx));
  }

  out.push(...followupTasks(c, ctx));
  return out;
}

function tptTasks(c: ContactTaskFields, ctx: ContactTaskContext): Task[] {
  const { today } = ctx;
  if (c.tpt_eligible !== 1) return [];
  const ended =
    !!c.tpt_end_date ||
    (TPT_ENDED_STATUSES as readonly string[]).includes(c.tpt_status?.trim() ?? "");
  if (ended) return [];

  if (!c.tpt_start_date) {
    return [task("C:start", "C", "เริ่มยา TPT", c.screen_date, today)];
  }

  const months = tptMonths(c.tpt_regimen);
  if (!months) {
    return [task("C:regimen", "C", "ระบุสูตรยา TPT", today, today)];
  }

  // นัดเดือนที่ k ถือว่ามาแล้วเมื่อมี visit TPT หลังเริ่มยาครบ k ครั้ง
  const start = c.tpt_start_date;
  const seen = (ctx.tptVisitDates ?? []).filter((d) => d > start).length;
  const next = seen + 1;
  if (next <= months) {
    return [task(`C:tpt-${next}`, "C", `นัด TPT เดือนที่ ${next}/${months}`, addMonths(start, next), today)];
  }
  return [task("C:end", "C", "สรุปผล TPT (กินครบ/หยุดยา)", addMonths(start, months), today)];
}

function followupTasks(c: ContactTaskFields, ctx: ContactTaskContext): Task[] {
  const { indexStartDate: start, today } = ctx;
  const pending = CONTACT_FOLLOWUP_MONTHS[c.contact_type]
    .filter((m) => !c[`fu${m}_date` as const])
    .map((m) => task(`D:${m}`, "D", `ติดตาม ${m} เดือน`, start && addMonths(start, m), today));
  // แสดงนัดที่ใกล้ที่สุด + ที่เลยกำหนดไปแล้ว ไม่ต้องโชว์นัดอีก 2 ปีข้างหน้าทั้งหมด
  return pending.filter((t, i) => i === 0 || t.status === "overdue");
}

type PatientTaskFields = Pick<PatientRow, "start_date" | "regimen" | "outcome">;

export interface PatientTaskContext {
  contactCount: number;
  followups: readonly Pick<FollowupRow, "month_no" | "test_type" | "test_date" | "result">[];
  today: IsoDate;
}

export function isConcluded(outcome: string | null | undefined): boolean {
  const o = outcome?.trim();
  return !!o && o !== OUTCOME_ONGOING;
}

export function patientTasks(p: PatientTaskFields, ctx: PatientTaskContext): Task[] {
  if (isConcluded(p.outcome)) return [];
  const { today } = ctx;
  const start = p.start_date;
  const out: Task[] = [];

  if (ctx.contactCount === 0) {
    out.push(task("P:no-contacts", "P", "ยังไม่มีผู้สัมผัส", start && addDays(start, CONTACTS_WITHIN_DAYS), today));
  }

  for (const m of PATIENT_AFB_MONTHS) {
    const done = ctx.followups.some(
      (f) => f.month_no === m && f.test_type?.trim().toUpperCase() === "AFB" && !!(f.result?.trim() || f.test_date),
    );
    if (!done) {
      out.push(task(`P:afb-${m}`, "P", `ตรวจ AFB เดือน ${m}`, start && addMonths(start, m), today));
    }
  }

  out.push(task("P:conclude", "P", "สรุปผลการรักษา", start && addMonths(start, regimenMonths(p.regimen)), today));
  return out;
}
