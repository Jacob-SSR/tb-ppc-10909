import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FOLLOWUP_SLOTS, MAX_FOLLOWUP_SLOTS } from "../../lib/tb/constants.ts";
import { followupsForForm, legacyFollowupColumns, nextFreeSlot, validateFollowups } from "../../lib/tb/followups.ts";
import { isEntityId, isValidCid, newEntityId } from "../../lib/tb/ids.ts";
import { findTarget, successRate, targetProgress, treatmentCoverage } from "../../lib/tb/targets.ts";

const empty = (slot: number) => ({ slot, month_no: 3, test: "AFB" as const, test_date: null, result: null, note: null });

test("followupsForForm: 5 ช่องเริ่มต้นเสมอ + ช่องที่เพิ่ม เรียงตาม slot", () => {
  const rows = followupsForForm([{ slot: 7, month_no: 8, test: "culture", test_date: null, result: null, note: null },
    { slot: 2, month_no: 2, test: "AFB", test_date: "2026-12-01", result: "NEG", note: null }]);
  assert.deepEqual(rows.map((r) => r.slot), [1, 2, 3, 4, 5, 7]);
  assert.equal(rows[1].result, "NEG");
  assert.deepEqual(rows.slice(0, 5).map((r) => `${r.month_no}${r.test}`), ["2CXR", "2AFB", "5AFB", "6CXR", "6AFB"]);
});

test("nextFreeSlot: ครบ 12 → null (ซ่อนปุ่ม + เพิ่มเติม)", () => {
  assert.equal(nextFreeSlot([1, 2, 3, 4, 5]), 6);
  assert.equal(nextFreeSlot([1, 2, 4]), 3);
  assert.equal(nextFreeSlot(Array.from({ length: MAX_FOLLOWUP_SLOTS }, (_, i) => i + 1)), null);
});

test("validateFollowups", () => {
  assert.deepEqual(validateFollowups([empty(1), empty(12)]), []);
  assert.equal(validateFollowups(Array.from({ length: 13 }, (_, i) => empty(i + 1))).length > 0, true);
  assert.equal(validateFollowups([empty(0)]).length, 1);
  assert.equal(validateFollowups([empty(3), empty(3)]).length, 1);
  assert.equal(validateFollowups([{ ...empty(6), month_no: 25 }]).length, 1);
  assert.equal(validateFollowups([{ ...empty(6), test: "Sputum" as never }]).length, 1);
});

test("legacyFollowupColumns: slot 1–5 → หัวคอลัมน์เดิมของ DB_Patients", () => {
  assert.deepEqual(DEFAULT_FOLLOWUP_SLOTS.map((d) => d.legacyColumn), ["เดือน2 CXR", "เดือน2 AFB", "เดือน5 AFB", "เดือน6 CXR", "เดือน6 AFB"]);
  assert.deepEqual(legacyFollowupColumns([{ slot: 2, result: "NEG" }, { slot: 9, result: "x" }]), {
    "เดือน2 CXR": "", "เดือน2 AFB": "NEG", "เดือน5 AFB": "", "เดือน6 CXR": "", "เดือน6 AFB": "",
  });
});

test("findTarget: ไตรมาสไม่ตั้ง = null ไม่ fallback ไปเป้าทั้งปี", () => {
  const targets = [
    { fy: 2570, quarter: 0 as const, indicator: "success_rate", target: "88.00", unit: "percent" as const },
    { fy: 2570, quarter: 1 as const, indicator: "new_cases", target: 12, unit: "cases" as const },
  ];
  assert.equal(findTarget(targets, 2570, 0, "success_rate"), 88);
  assert.equal(findTarget(targets, 2570, 1, "success_rate"), null);
  assert.equal(findTarget(targets, 2570, 1, "new_cases"), 12);
  assert.equal(findTarget(targets, 2569, 1, "new_cases"), null);
});

test("targetProgress: A/B + % + ยังไม่ตั้งเป้า (ห้าม 0%)", () => {
  assert.deepEqual(targetProgress(5, null), {
    actual: 5, target: null, notSet: true, pct: null, barPct: 0, reached: false, label: "ยังไม่ตั้งเป้า",
  });
  const p = targetProgress(9, 12);
  assert.equal(p.label, "9/12");
  assert.equal(p.pct, 75);
  assert.equal(p.barPct, 75);
  assert.equal(p.reached, false);
  const over = targetProgress(15, 12);
  assert.equal(over.pct, 125);
  assert.equal(over.barPct, 100);
  assert.equal(over.reached, true);
  assert.equal(targetProgress(0, 0).pct, null);
});

test("Treatment Coverage / Success Rate ตามแดชบอร์ดเดิม", () => {
  const pts = [
    { patient_type: "NEW", outcome: "หาย" },
    { patient_type: "Relapse", outcome: "รักษาครบ" },
    { patient_type: "Transfer in", outcome: "เสียชีวิต" },
    { patient_type: "NEW", outcome: "กำลังรักษา" },
  ];
  assert.deepEqual(treatmentCoverage(pts, 6), { count: 3, pct: 50 });
  assert.deepEqual(treatmentCoverage(pts, null), { count: 3, pct: null });
  const sr = successRate(pts);
  assert.equal(sr.success, 2);
  assert.equal(sr.concluded, 3);
  assert.ok(Math.abs(sr.pct! - 66.67) < 0.01);
  assert.equal(successRate([{ outcome: "กำลังรักษา" }]).pct, null);
});

test("รหัสระบบ P/C/V + 10 hex และเลขบัตร 13 หลัก", () => {
  const id = newEntityId("P");
  assert.match(id, /^P[0-9a-f]{10}$/);
  assert.equal(isEntityId(id, "P"), true);
  assert.equal(isEntityId(id, "C"), false);
  assert.equal(isEntityId("P12345"), false);
  assert.equal(isValidCid("1101700203450"), true);
  assert.equal(isValidCid("3100600271432"), true);
  assert.equal(isValidCid("1101700203451"), false);
  assert.equal(isValidCid("110170020345"), false);
  assert.equal(isValidCid(null), false);
});
