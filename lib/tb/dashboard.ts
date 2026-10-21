// lib/tb/dashboard.ts — ผลงานรายตัวชี้วัดตามช่วงเวลา (ทั้งปีงบ / ไตรมาส) สำหรับการ์ด A/B (§6.1)
// ผู้ป่วยนับเข้าช่วงตาม "วันขึ้นทะเบียน" = วันเริ่มยา (ไม่มีใช้วันวินิจฉัย) แบบเดียวกับแดชบอร์ดเดิม
// Success/Death นับเฉพาะผู้ป่วยในช่วงนั้นที่สรุปผลแล้ว (ยังไม่ใช่ cohort — รอยืนยัน §11 ข้อ 3)

import { inRange, periodRange, type DateRange, type Quarter } from "./dates.ts";
import { findTarget, isNewOrRelapse, targetProgress, type PeriodQuarter, type TargetProgress } from "./targets.ts";
import { isConcluded, patientStart } from "./tasks.ts";
import type { PatientRow, TargetRow } from "./types.ts";

type P = Pick<PatientRow, "start_date" | "diag_date" | "patient_type" | "outcome">;

export function patientsInPeriod<T extends P>(patients: readonly T[], range: DateRange): T[] {
  return patients.filter((p) => inRange(patientStart(p), range));
}

export interface IndicatorResult {
  id: string;
  /** ผลงาน (จำนวนราย หรือ ร้อยละ) */
  actual: number | null;
  /** ตัวตั้ง/ตัวหาร ที่ใช้คิดร้อยละ (แสดงประกอบ เช่น "หาย+ครบ 20 / สรุปผล 23") */
  numerator: number;
  denominator: number | null;
  progress: TargetProgress;
  /** ผ่านเป้าหรือยัง (ยิ่งต่ำยิ่งดีกลับด้าน) — null = ยังไม่ตั้งเป้า/ยังคำนวณไม่ได้ */
  pass: boolean | null;
  /** เหตุที่ยังคำนวณไม่ได้ */
  note?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeIndicators(
  patients: readonly P[],
  targets: readonly TargetRow[],
  fy: number,
  quarter: PeriodQuarter,
  mode: "quarter" | "ytd" = "quarter",
): { range: DateRange; inPeriod: number; results: Record<string, IndicatorResult> } {
  const range = periodRange(fy, quarter as 0 | Quarter, mode);
  const ps = patientsInPeriod(patients, range);
  const t = (id: string) => findTarget(targets, fy, quarter, id);

  const newRelapse = ps.filter(isNewOrRelapse).length;
  const concluded = ps.filter((p) => isConcluded(p.outcome));
  const success = concluded.filter((p) => p.outcome === "หาย" || p.outcome === "รักษาครบ").length;
  const died = concluded.filter((p) => p.outcome === "เสียชีวิต").length;

  const caseTarget = t("case_finding");
  const results: Record<string, IndicatorResult> = {};

  results.case_finding = {
    id: "case_finding", actual: newRelapse, numerator: newRelapse, denominator: caseTarget,
    progress: targetProgress(newRelapse, caseTarget),
    pass: caseTarget === null ? null : newRelapse >= caseTarget,
  };

  const covActual = caseTarget ? round1((newRelapse * 100) / caseTarget) : null;
  const covTarget = t("coverage");
  results.coverage = {
    id: "coverage", actual: covActual, numerator: newRelapse, denominator: caseTarget,
    progress: targetProgress(covActual ?? 0, covTarget),
    pass: covActual === null || covTarget === null ? null : covActual >= covTarget,
    note: caseTarget ? undefined : "ต้องตั้งเป้าจำนวนผู้ป่วย (ผู้ป่วยใหม่+กลับเป็นซ้ำ) ของช่วงนี้ก่อน",
  };

  const sr = concluded.length ? round1((success * 100) / concluded.length) : null;
  const srTarget = t("success_rate");
  results.success_rate = {
    id: "success_rate", actual: sr, numerator: success, denominator: concluded.length,
    progress: targetProgress(sr ?? 0, srTarget),
    pass: sr === null || srTarget === null ? null : sr >= srTarget,
    note: concluded.length ? undefined : "ยังไม่มีผู้ป่วยที่สรุปผลในช่วงนี้",
  };

  const dr = concluded.length ? round1((died * 100) / concluded.length) : null;
  const drTarget = t("death_rate");
  results.death_rate = {
    id: "death_rate", actual: dr, numerator: died, denominator: concluded.length,
    progress: targetProgress(dr ?? 0, drTarget),
    pass: dr === null || drTarget === null ? null : dr <= drTarget,
    note: concluded.length ? undefined : "ยังไม่มีผู้ป่วยที่สรุปผลในช่วงนี้",
  };

  return { range, inPeriod: ps.length, results };
}

/** นับตามค่าในช่อง (เรียงมากไปน้อย) สำหรับกราฟแท่งแนวนอน */
export function countBy<T>(rows: readonly T[], key: (r: T) => string | null | undefined, empty = "ไม่ระบุ"): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r)?.toString().trim() || empty;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** จำนวนขึ้นทะเบียนรายเดือนของปีงบ (ต.ค.–ก.ย.) */
export function monthlyRegistrations(patients: readonly P[], fy: number): number[] {
  const out = new Array<number>(12).fill(0);
  const startYear = fy - 543 - 1;
  for (const p of patients) {
    const d = patientStart(p);
    if (!d) continue;
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const idx = (y - startYear) * 12 + (m - 10);
    if (idx >= 0 && idx < 12) out[idx]++;
  }
  return out;
}

export const FY_MONTH_LABELS = ["ต.ค.", "พ.ย.", "ธ.ค.", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย."];
