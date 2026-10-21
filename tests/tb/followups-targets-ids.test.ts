import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FOLLOWUP_SLOTS, MAX_FOLLOWUP_SLOTS } from "../../lib/tb/constants.ts";
import { followupsForForm, legacyFollowupColumns, nextFreeSlot, validateFollowups } from "../../lib/tb/followups.ts";
import { isEntityId, isValidCid, newEntityId } from "../../lib/tb/ids.ts";
import { findTarget, targetProgress } from "../../lib/tb/targets.ts";

const empty = (slot: number) => ({ slot, month_no: 3, test_type: "AFB", test_date: null, result: null });

test("followupsForForm: 5 ช่องเริ่มต้นเสมอ + ช่องที่เพิ่ม เรียงตาม slot", () => {
  const rows = followupsForForm([{ slot: 7, month_no: 8, test_type: "Culture", test_date: null, result: null },
    { slot: 2, month_no: 2, test_type: "AFB", test_date: "2026-12-01", result: "NEG" }]);
  assert.deepEqual(rows.map((r) => r.slot), [1, 2, 3, 4, 5, 7]);
  assert.equal(rows[1].result, "NEG");
  assert.deepEqual(rows.slice(0, 5).map((r) => `${r.month_no}${r.test_type}`), ["2CXR", "2AFB", "5AFB", "6CXR", "6AFB"]);
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
  assert.equal(validateFollowups([{ ...empty(6), month_no: 99 }]).length, 1);
});

test("legacyFollowupColumns: slot 1–5 → หัวคอลัมน์เดิมของ DB_Patients", () => {
  assert.deepEqual(DEFAULT_FOLLOWUP_SLOTS.map((d) => d.legacyColumn), ["เดือน2 CXR", "เดือน2 AFB", "เดือน5 AFB", "เดือน6 CXR", "เดือน6 AFB"]);
  assert.deepEqual(legacyFollowupColumns([{ slot: 2, result: "NEG" }, { slot: 9, result: "x" }]), {
    "เดือน2 CXR": "", "เดือน2 AFB": "NEG", "เดือน5 AFB": "", "เดือน6 CXR": "", "เดือน6 AFB": "",
  });
});

test("findTarget: ไตรมาสไม่ตั้ง = null ไม่ fallback ไปเป้าทั้งปี", () => {
  const targets = [
    { fy: 2570, quarter: 0 as const, indicator: "success_rate", target_value: "88.00" },
    { fy: 2570, quarter: 1 as const, indicator: "new_cases", target_value: 12 },
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
