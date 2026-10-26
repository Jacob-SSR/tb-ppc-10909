import assert from "node:assert/strict";
import { test } from "node:test";
import { fromSheetRecord, legacyFollowupExtra, toSheetRow } from "../../lib/tb/sheetRows.ts";
import { CONTACT_SHEET_COLUMNS, PATIENT_SHEET_COLUMNS } from "../../lib/tb/sheetColumns.ts";

test("toSheetRow ผู้ป่วย: ลำดับหัวเดิม, ผล followup slot 1–5, วันที่ ISO หรือ พ.ศ.", () => {
  const row = { id: "P0123456789", fy: 2569, name: "ทดสอบ", hn: "1", start_date: "2026-01-15", unit_id: 2, outcome: "กำลังรักษา", updated_at: "2026-10-21 10:00:00" };
  const extra = { ...legacyFollowupExtra([{ slot: 2, result: "NEG" }]), updated_by_name: "ผู้ดูแล" };
  const iso = toSheetRow("patient", row, { dateFormat: "iso", unitName: (id) => (id === 2 ? "รพ.สต.ตาพระ" : ""), extra });
  const at = (h: string) => iso[PATIENT_SHEET_COLUMNS.findIndex((c) => c[0] === h)];
  assert.equal(iso.length, PATIENT_SHEET_COLUMNS.length);
  assert.equal(at("รหัสระบบ"), "P0123456789");
  assert.equal(at("วันเริ่มยา"), "2026-01-15");
  assert.equal(at("รพ.สต.รับผิดชอบ"), "รพ.สต.ตาพระ");
  assert.equal(at("เดือน2 AFB"), "NEG");
  assert.equal(at("เดือน2 CXR"), "");
  assert.equal(at("แก้ไขโดย"), "ผู้ดูแล");
  const thai = toSheetRow("patient", row, { dateFormat: "thai" });
  assert.equal(thai[PATIENT_SHEET_COLUMNS.findIndex((c) => c[0] === "วันเริ่มยา")], "15/01/2569");
});

test("toSheetRow ผู้สัมผัส: ประเภทเป็นข้อความเดิม + คอลัมน์ใหม่ต่อท้าย", () => {
  const out = toSheetRow("contact", { id: "C0123456789", contact_type: "close", current_address: "ที่อยู่จริง" }, { dateFormat: "iso", extra: { fy: 2570, index_hn: "99" } });
  assert.equal(out.length, CONTACT_SHEET_COLUMNS.length + 2);
  assert.equal(out[CONTACT_SHEET_COLUMNS.findIndex((c) => c[0] === "ประเภทการสัมผัส")], "ใกล้ชิด (Close contact)");
  assert.equal(out[CONTACT_SHEET_COLUMNS.findIndex((c) => c[0] === "ปีงบ")], "2570");
  assert.equal(out[CONTACT_SHEET_COLUMNS.findIndex((c) => c[0] === "HN ผู้ป่วย index")], "99");
  assert.equal(out.at(-2), "ที่อยู่จริง");
});

test("fromSheetRecord ผู้ป่วย: หัวไทยเดิม → คอลัมน์ DB, followup เดิม, meta", () => {
  const r = fromSheetRecord("patient", {
    "รหัสระบบ": "P0123456789", "ปีงบ": "2569", "ชื่อ-สกุล": " นายทดสอบ ", "HN": "460000001", "TB number": "",
    "วันเริ่มยา": "2026-01-15", "วัน admit": "15/01/2569", "เดือน2 AFB": "NEG ", "เดือน5 AFB": "-",
    "รพ.สต.รับผิดชอบ": "", "แก้ไขโดย": "ย้ายจากแท็บ ปีงบ 2569", "แก้ไขเมื่อ": "2026-10-20 09:00:00", "คอลัมน์แปลก": "x",
  });
  assert.equal(r.id, "P0123456789");
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.name, "นายทดสอบ");
  assert.equal(r.data.tb_no, null);
  assert.equal(r.data.fy, "2569");
  assert.equal(r.data.admit_date, "2026-01-15");
  assert.deepEqual(r.legacyFollowups, [
    { slot: 2, month_no: 2, test: "AFB", result: "NEG" },
    { slot: 3, month_no: 5, test: "AFB", result: "-" },
  ]);
  assert.equal(r.meta.updatedBy, "ย้ายจากแท็บ ปีงบ 2569");
  assert.equal(r.meta.unitName, null);
  assert.ok(!("คอลัมน์แปลก" in r.data));
});

test("fromSheetRecord ผู้สัมผัส: ประเภท/วันที่ผิด → errors", () => {
  const ok = fromSheetRecord("contact", { "ประเภทการสัมผัส": "ร่วมบ้าน (Household)", "HN ผู้ป่วย index": "1", "วันสอบสวน": "21/10/2569" });
  assert.equal(ok.data.contact_type, "household");
  assert.equal(ok.data.invest_date, "2026-10-21");
  assert.equal(ok.meta.indexHn, "1");
  const bad = fromSheetRecord("contact", { "ประเภทการสัมผัส": "วง 3", "วันสอบสวน": "31/02/2569" });
  assert.equal(bad.errors.length, 2);
});
