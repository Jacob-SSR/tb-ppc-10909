// lib/tb/targets.ts
// เป้าหมายตัวชี้วัด แยกปีงบ + ไตรมาส (§6.1) — การ์ดแสดง A/B = ผลงาน/เป้าหมาย

import type { TargetRow } from "./types.ts";

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
  const v = Number(t.target_value);
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
