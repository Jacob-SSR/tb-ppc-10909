import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAppointments, latestAppointments } from "../../lib/tb/appointments.ts";
import { DEFAULT_FOLLOWUP_SLOTS } from "../../lib/tb/constants.ts";
import { CONTACT_TYPE_SHEET_LABEL, contactTypeFromLabel } from "../../lib/tb/options.ts";
import { CONTACT_SHEET_COLUMNS, PATIENT_SHEET_COLUMNS, VISIT_SHEET_COLUMNS } from "../../lib/tb/sheetColumns.ts";

const v = (id: string, ref: { patient_id?: string; contact_id?: string }, visit_date: string, next_appt: string | null, updated_at = `${visit_date} 10:00:00`) => ({
  id, patient_id: ref.patient_id ?? null, contact_id: ref.contact_id ?? null, visit_date, visit_type: "ติดตามอาการ/รับยา", detail: "x", next_appt, updated_at,
});

test("latestAppointments: นัดจากบันทึกครั้งล่าสุดของแต่ละราย", () => {
  const list = latestAppointments([
    v("V1", { patient_id: "P1" }, "2026-10-01", "2026-10-15"),
    v("V2", { patient_id: "P1" }, "2026-10-15", "2026-11-12"), // มาตามนัด → นัดย้าย
    v("V3", { contact_id: "C1" }, "2026-10-10", "2026-10-20"),
    v("V4", { contact_id: "C1" }, "2026-10-18", null), // บันทึกล่าสุดไม่มีนัด → ไม่มีนัดค้าง
    v("V5", { patient_id: "P2" }, "2026-10-05", "2026-10-19", "2026-10-05 09:00:00"),
    v("V6", { patient_id: "P2" }, "2026-10-05", "2026-10-26", "2026-10-05 15:00:00"), // วันเดียวกัน ใช้ที่บันทึกทีหลัง
    v("V7", { patient_id: "P3" }, "2026-10-05", "2026-10-22"),
  ], (pid) => pid !== "P3"); // P3 สรุปผลแล้ว
  assert.deepEqual(list.map((a) => [a.refId, a.kind, a.appt, a.last.id]), [
    ["P2", "P", "2026-10-26", "V6"],
    ["P1", "P", "2026-11-12", "V2"],
  ]);
});

test("groupAppointments: ขาดนัด / วันนี้ / พรุ่งนี้ / 7 วัน / หลังจากนั้น", () => {
  const g = groupAppointments(
    ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-28", "2026-10-29"].map((appt) => ({ appt })),
    "2026-10-21",
  );
  assert.deepEqual([g.missed, g.today, g.tomorrow, g.week, g.later].map((x) => x.map((a) => a.appt)), [
    ["2026-10-20"], ["2026-10-21"], ["2026-10-22"], ["2026-10-28"], ["2026-10-29"],
  ]);
});

test("contactTypeFromLabel: ค่าใน Sheet เดิม → household/close", () => {
  assert.equal(contactTypeFromLabel(CONTACT_TYPE_SHEET_LABEL.household), "household");
  assert.equal(contactTypeFromLabel(CONTACT_TYPE_SHEET_LABEL.close), "close");
  assert.equal(contactTypeFromLabel("ใกล้ชิด"), "close");
  assert.equal(contactTypeFromLabel(""), "household"); // ระบบเดิมถือว่าร่วมบ้าน
  assert.equal(contactTypeFromLabel(null), "household");
  assert.equal(contactTypeFromLabel("วง 3"), null);
});

test("หัวคอลัมน์ Sheet เดิมครบและไม่ซ้ำ", () => {
  // 38 คอลัมน์เดิมตามลำดับเดิม + คอลัมน์ใหม่ต่อท้าย (ไม่ให้คอลัมน์เดิมเลื่อน)
  assert.equal(PATIENT_SHEET_COLUMNS[37][0], "แก้ไขเมื่อ");
  assert.deepEqual(PATIENT_SHEET_COLUMNS.slice(38).map((c) => c[0]), ["ที่อยู่ปัจจุบัน", "อำเภอ", "จังหวัด", "รหัสไปรษณีย์"]);
  assert.equal(CONTACT_SHEET_COLUMNS.length, 39);
  assert.equal(VISIT_SHEET_COLUMNS.length, 8);
  for (const cols of [PATIENT_SHEET_COLUMNS, CONTACT_SHEET_COLUMNS, VISIT_SHEET_COLUMNS]) {
    assert.equal(new Set(cols.map((c) => c[0])).size, cols.length);
    assert.equal(cols[0][0], "รหัสระบบ");
  }
  // ผลการรักษาอยู่คอลัมน์ AH (ลำดับ 34) — ppc-hos อ่านแค่ A:Z จึงหลุด (CLAUDE.md §9)
  assert.equal(PATIENT_SHEET_COLUMNS.findIndex((c) => c[0] === "ผลการรักษา"), 33);
  for (const d of DEFAULT_FOLLOWUP_SLOTS) {
    assert.deepEqual(PATIENT_SHEET_COLUMNS.find((c) => c[0] === d.legacyColumn), [d.legacyColumn, `followup:${d.slot}`]);
  }
});
