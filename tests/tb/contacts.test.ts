import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatContactSummary,
  isTB,
  isTBSql,
  patientDraftFromContact,
  summarizeContacts,
  tbTreatPlace,
} from "../../lib/tb/contacts.ts";
import { TB_RESULT } from "../../lib/tb/constants.ts";
import { contact } from "./fixtures.ts";

test("isTB: new_patient_id หรือผลใดๆ = ป่วยเป็นวัณโรค", () => {
  assert.equal(isTB(contact()), false);
  assert.equal(isTB(contact({ screen_result: "ไม่ป่วย" })), false);
  assert.equal(isTB(contact({ new_patient_id: "P00000000ab" })), true);
  assert.equal(isTB(contact({ screen_result: TB_RESULT })), true);
  assert.equal(isTB(contact({ screen_result: ` ${TB_RESULT} ` })), true);
  for (const col of ["fu6_result", "fu12_result", "fu18_result", "fu24_result"] as const) {
    assert.equal(isTB(contact({ [col]: TB_RESULT })), true, col);
  }
});

test("isTBSql ใช้คอลัมน์ชุดเดียวกับ isTB และกัน alias แปลก", () => {
  const sql = isTBSql("c");
  for (const col of ["new_patient_id", "screen_result", "fu6_result", "fu12_result", "fu18_result", "fu24_result"]) {
    assert.ok(sql.includes(`c.${col}`), col);
  }
  assert.ok(sql.includes(`'${TB_RESULT}'`));
  assert.throws(() => isTBSql("c; DROP TABLE x"));
});

test("summarizeContacts + formatContactSummary (§6.3)", () => {
  const map = summarizeContacts([
    { patient_id: "P1", contact_type: "household", total: "3", tb: "1" },
    { patient_id: "P1", contact_type: "close", total: 2, tb: null },
    { patient_id: "P2", contact_type: "close", total: 1, tb: 1 },
  ]);
  const p1 = map.get("P1")!;
  assert.deepEqual(p1, { total: 5, tb: 1, household: { total: 3, tb: 1 }, close: { total: 2, tb: 0 } });
  assert.equal(formatContactSummary(p1), "ผู้สัมผัส 5 · ร่วมบ้าน 3 (TB 1) · ใกล้ชิด 2 (TB 0)");
  assert.equal(map.get("P2")!.household.total, 0);
  assert.equal(map.has("P3"), false);
});

test("tbTreatPlace: ลงทะเบียนในระบบใช้ reg_place, ไม่งั้นใช้ tb_treat_place", () => {
  assert.deepEqual(
    tbTreatPlace(contact({ new_patient_id: "P00000000ab", tb_treat_place: "อื่น" }), { id: "P00000000ab", reg_place: "รพ.พลับพลาชัย" }),
    { place: "รพ.พลับพลาชัย", patientId: "P00000000ab" },
  );
  assert.deepEqual(tbTreatPlace(contact({ tb_treat_place: "รพ.บุรีรัมย์" })), { place: "รพ.บุรีรัมย์", patientId: null });
  assert.deepEqual(tbTreatPlace(contact()), { place: null, patientId: null });
});

test("patientDraftFromContact ตาม convertContactToPatient เดิม", () => {
  const { patient, contactUpdate } = patientDraftFromContact(
    contact({ name: "ก ข", hn: "1", address: "ทะเบียน", current_address: "ปัจจุบัน", unit_id: 3, screen_date: "2026-09-21" }),
    { id: "P00000000ff", startDate: "2026-10-02", indexHn: "460000001", today: "2026-10-21" },
  );
  assert.equal(patient.fy, 2570); // จากวันเริ่มยา
  assert.equal(patient.diag_date, "2026-09-21");
  assert.equal(patient.address, "ปัจจุบัน");
  assert.equal(patient.reg_place, "รพ.พลับพลาชัย");
  assert.equal(patient.outcome, "กำลังรักษา");
  assert.equal(patient.notes, "พบจากการคัดกรองผู้สัมผัสของ HN 460000001");
  assert.deepEqual(contactUpdate, { new_patient_id: "P00000000ff", screen_result: TB_RESULT });
  // ไม่มีวันเริ่มยา → ปีงบจากวันคัดกรอง
  const d2 = patientDraftFromContact(contact({ address: "ทะเบียน", screen_date: "2026-09-21" }), { id: "P00000000ff", startDate: null, indexHn: null, today: "2026-10-21" });
  assert.equal(d2.patient.fy, 2569);
  assert.equal(d2.patient.address, "ทะเบียน");
});
