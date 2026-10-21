// lib/tb/followups.ts
// หมวด 4 ติดตามระหว่างรักษา: 5 ช่องเริ่มต้น เพิ่มได้ถึง 12 ช่อง (§6.4)

import { DEFAULT_FOLLOWUP_SLOTS, MAX_FOLLOWUP_SLOTS } from "./constants.ts";
import type { FollowupRow, FollowupTest } from "./types.ts";

/** ค่าใน ENUM ของคอลัมน์ tb_treatment_followups.test */
export const FOLLOWUP_TESTS: readonly FollowupTest[] = ["CXR", "AFB", "Xpert", "culture", "LFT", "other"];

export type FollowupInput = Omit<FollowupRow, "patient_id">;

/** ช่องที่ฟอร์มต้องแสดง: 5 ช่องเริ่มต้นเสมอ (เติมค่าว่าง) + ช่องที่เพิ่มเอง เรียงตาม slot */
export function followupsForForm(rows: readonly FollowupInput[]): FollowupInput[] {
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  for (const d of DEFAULT_FOLLOWUP_SLOTS) {
    if (!bySlot.has(d.slot)) {
      bySlot.set(d.slot, {
        slot: d.slot, month_no: d.month_no, test: d.test, test_date: null, result: null, note: null,
      });
    }
  }
  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

/** slot ว่างตัวแรกสำหรับปุ่ม "+ เพิ่มเติม" — null = ครบ 12 แล้ว (ซ่อนปุ่ม) */
export function nextFreeSlot(usedSlots: Iterable<number>): number | null {
  const used = new Set(usedSlots);
  for (let s = 1; s <= MAX_FOLLOWUP_SLOTS; s++) if (!used.has(s)) return s;
  return null;
}

/** ตรวจชุด followup ก่อนบันทึก — คืนรายการข้อผิดพลาด (ว่าง = ผ่าน) */
export function validateFollowups(rows: readonly FollowupInput[]): string[] {
  const errors: string[] = [];
  if (rows.length > MAX_FOLLOWUP_SLOTS) errors.push(`ติดตามระหว่างรักษาได้ไม่เกิน ${MAX_FOLLOWUP_SLOTS} ช่อง`);
  const seen = new Set<number>();
  for (const r of rows) {
    if (!Number.isInteger(r.slot) || r.slot < 1 || r.slot > MAX_FOLLOWUP_SLOTS) {
      errors.push(`ช่องที่ ${r.slot} ไม่ถูกต้อง (ต้องเป็น 1–${MAX_FOLLOWUP_SLOTS})`);
    }
    if (seen.has(r.slot)) errors.push(`ช่องที่ ${r.slot} ซ้ำ`);
    seen.add(r.slot);
    if (!Number.isInteger(r.month_no) || r.month_no < 0 || r.month_no > 24) {
      errors.push(`ช่องที่ ${r.slot}: เดือนที่ต้องเป็น 0–24`);
    }
    if (!FOLLOWUP_TESTS.includes(r.test)) errors.push(`ช่องที่ ${r.slot}: ชนิดตรวจไม่ถูกต้อง`);
  }
  return errors;
}

/** ค่าคอลัมน์เดิม "เดือน2 CXR … เดือน6 AFB" ใน DB_Patients ← slot 1–5 (ผลตรวจ) */
export function legacyFollowupColumns(rows: readonly Pick<FollowupRow, "slot" | "result">[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of DEFAULT_FOLLOWUP_SLOTS) {
    out[d.legacyColumn] = rows.find((r) => r.slot === d.slot)?.result ?? "";
  }
  return out;
}
