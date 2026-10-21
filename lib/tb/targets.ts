// lib/tb/targets.ts
// เป้าหมายตัวชี้วัด แยกปีงบ + ไตรมาส (§6.1) — การ์ดแสดง A/B = ผลงาน/เป้าหมาย
// + สูตร Treatment Coverage / Success Rate ตามแดชบอร์ดเดิม

import { OUTCOME_SUCCESS } from "./constants.ts";
import { isConcluded } from "./tasks.ts";
import type { PatientRow, TargetRow } from "./types.ts";

export type PeriodQuarter = 0 | 1 | 2 | 3 | 4; // 0 = ทั้งปีงบ

export const PERIOD_LABEL: Record<PeriodQuarter, string> = {
  0: "ทั้งปีงบ",
  1: "Q1",
  2: "Q2",
  3: "Q3",
  4: "Q4",
};

/**
 * เป้าของตัวชี้วัดในช่วงนั้น — ไม่ fallback ไปใช้เป้าทั้งปีกับไตรมาส
 * ไตรมาสที่ยังไม่ตั้ง = null → การ์ดแสดง "ยังไม่ตั้งเป้า" (ห้ามแสดง 0%)
 */
export function findTarget(
  targets: readonly TargetRow[],
  fy: number,
  quarter: PeriodQuarter,
  indicator: string,
): number | null {
  const t = targets.find((r) => r.fy === fy && Number(r.quarter) === quarter && r.indicator === indicator);
  if (!t) return null;
  const v = Number(t.target);
  return Number.isFinite(v) ? v : null;
}

export interface TargetProgress {
  actual: number;
  target: number | null;
  notSet: boolean;
  /** ร้อยละของเป้า (ไม่ตัดที่ 100) — null เมื่อยังไม่ตั้งเป้าหรือเป้า = 0 */
  pct: number | null;
  /** ความกว้างแถบ progress 0–100 */
  barPct: number;
  reached: boolean;
  /** "12/20" หรือ "ยังไม่ตั้งเป้า" */
  label: string;
}

export function targetProgress(actual: number, target: number | null): TargetProgress {
  if (target === null) {
    return { actual, target: null, notSet: true, pct: null, barPct: 0, reached: false, label: "ยังไม่ตั้งเป้า" };
  }
  const pct = target > 0 ? Math.round((actual / target) * 1000) / 10 : null;
  return {
    actual,
    target,
    notSet: false,
    pct,
    barPct: pct === null ? (actual > 0 ? 100 : 0) : Math.min(100, Math.max(0, pct)),
    reached: actual >= target,
    label: `${actual}/${target}`,
  };
}

// ── ตัวชี้วัดของแดชบอร์ดเดิม ────────────────────────────────────────────────

/** ผู้ป่วยใหม่ + กลับเป็นซ้ำ (ตัวตั้งของ Treatment Coverage) */
export function isNewOrRelapse(p: Pick<PatientRow, "patient_type">): boolean {
  return p.patient_type === "NEW" || p.patient_type === "Relapse";
}

/**
 * Treatment Coverage = ผู้ป่วยใหม่และกลับเป็นซ้ำที่ขึ้นทะเบียน ÷ เป้าจำนวนที่จังหวัดคาดประมาณ × 100
 * คืน null เมื่อยังไม่ตั้งเป้า (ระบบเดิมเก็บใน DB_Settings key target_cases_<ปีงบ>, เป้า % default 88)
 */
export function treatmentCoverage(
  patients: readonly Pick<PatientRow, "patient_type">[],
  targetCases: number | null,
): { count: number; pct: number | null } {
  const count = patients.filter(isNewOrRelapse).length;
  return { count, pct: targetCases ? (count * 100) / targetCases : null };
}

/**
 * Success Rate = (หาย + รักษาครบ) ÷ ผู้ป่วยที่สรุปผลแล้ว × 100 (เป้า default 88)
 * ระบบเดิมนับผู้ป่วยทั้งปีงบที่สรุปผลแล้ว ไม่ใช่ cohort — รอยืนยัน (CLAUDE.md §11 ข้อ 3)
 */
export function successRate(
  patients: readonly Pick<PatientRow, "outcome">[],
): { success: number; concluded: number; pct: number | null } {
  const concluded = patients.filter((p) => isConcluded(p.outcome));
  const success = concluded.filter((p) => (OUTCOME_SUCCESS as readonly string[]).includes(p.outcome.trim())).length;
  return { success, concluded: concluded.length, pct: concluded.length ? (success * 100) / concluded.length : null };
}
