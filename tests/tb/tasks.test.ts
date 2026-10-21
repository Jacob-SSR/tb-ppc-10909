import assert from "node:assert/strict";
import { test } from "node:test";
import { TB_RESULT } from "../../lib/tb/constants.ts";
import { contactTasks, patientStart, patientTasks, screened, taskStatus, tptMonths } from "../../lib/tb/tasks.ts";
import { contact } from "./fixtures.ts";

const START = "2026-10-01"; // ผู้ป่วย index เริ่มยา
const steps = (ts: { step: string }[]) => ts.map((t) => t.step);

test("taskStatus", () => {
  assert.equal(taskStatus(null, "2026-10-21"), "unscheduled");
  assert.equal(taskStatus("2026-10-20", "2026-10-21"), "overdue");
  assert.equal(taskStatus("2026-10-21", "2026-10-21"), "due_soon");
  assert.equal(taskStatus("2026-10-28", "2026-10-21"), "due_soon");
  assert.equal(taskStatus("2026-10-29", "2026-10-21"), "upcoming");
});

test("patientStart: วันเริ่มยา ไม่มีใช้วันวินิจฉัย", () => {
  assert.equal(patientStart({ start_date: "2026-10-01", diag_date: "2026-09-20" }), "2026-10-01");
  assert.equal(patientStart({ start_date: null, diag_date: "2026-09-20" }), "2026-09-20");
  assert.equal(patientStart({ start_date: null, diag_date: null }), null);
  assert.equal(patientStart(undefined), null);
});

test("A: ยังไม่สอบสวน → งานเดียว กำหนด 7 วันหลังผู้ป่วยเริ่มยา", () => {
  const ts = contactTasks(contact(), { indexStart: START, today: "2026-10-05" });
  assert.deepEqual(ts, [{ step: "A", what: "สอบสวนผู้สัมผัส", due: "2026-10-08", status: "due_soon" }]);
  // ไม่รู้วันเริ่มยาของ index → ไม่มีกำหนด
  assert.equal(contactTasks(contact(), { indexStart: null, today: "2026-10-05" })[0].status, "unscheduled");
});

test("B: กำหนด 14 วันหลังวันสอบสวน, รอผล/ส่งตรวจเพิ่ม = ยังไม่จบ", () => {
  const ctx = { indexStart: START, today: "2026-10-21" };
  const c = contact({ invest_date: "2026-10-05" });
  assert.deepEqual(contactTasks(c, ctx), [{ step: "B", what: "คัดกรอง ซักอาการ + CXR", due: "2026-10-19", status: "overdue" }]);
  assert.equal(contactTasks({ ...c, screen_result: "รอผล" }, ctx)[0].what, "คัดกรอง ซักอาการ + CXR");
  assert.equal(contactTasks({ ...c, screen_result: "ส่งตรวจเพิ่ม" }, ctx)[0].what, "รอผลตรวจเพิ่ม");
});

test("C: เข้าเกณฑ์ยังไม่เริ่ม → เริ่ม TPT ภายใน 14 วันหลังคัดกรอง", () => {
  const c = contact({ invest_date: "2026-10-03", screen_date: "2026-10-05", screen_result: "ไม่ป่วย", tpt_eligible: "ใช่" });
  const ts = contactTasks(c, { indexStart: START, today: "2026-10-21" });
  assert.deepEqual(steps(ts), ["C", "D"]);
  assert.equal(ts[0].what, "เริ่ม TPT");
  assert.equal(ts[0].due, "2026-10-19");
  // ไม่ใช่ / ปฏิเสธ → ไม่มี C
  for (const v of ["ไม่ใช่", "ปฏิเสธ"]) {
    assert.deepEqual(steps(contactTasks({ ...c, tpt_eligible: v }, { indexStart: START, today: "2026-10-21" })), ["D"]);
  }
});

test("C: นัด TPT รายเดือน = เดือนแรกที่ยังไม่ผ่าน แล้วให้บันทึกสถานะเมื่อครบสูตร", () => {
  const c = contact({
    invest_date: "2026-10-03", screen_date: "2026-10-05", screen_result: "ไม่ป่วย",
    tpt_eligible: "ใช่", tpt_regimen: "3HP", tpt_start: "2026-10-10", tpt_status: "กำลังกิน",
  });
  const cOf = (today: string) => contactTasks(c, { indexStart: START, today }).find((t) => t.step === "C")!;
  assert.deepEqual([cOf("2026-10-21").what, cOf("2026-10-21").due], ["นัด TPT รายเดือน", "2026-11-10"]);
  assert.equal(cOf("2026-11-10").due, "2026-11-10");
  assert.equal(cOf("2026-11-11").due, "2026-12-10");
  assert.deepEqual([cOf("2027-01-11").what, cOf("2027-01-11").due], ["ครบระยะ TPT – บันทึกสถานะ", "2027-01-10"]);
  // สถานะว่างถือว่ากำลังกิน, สถานะอื่น = จบแล้ว
  assert.ok(contactTasks({ ...c, tpt_status: null }, { indexStart: START, today: "2026-10-21" }).some((t) => t.step === "C"));
  for (const s of ["กินครบ", "หยุดเพราะผลข้างเคียง", "ขาดยา/ปฏิเสธ"]) {
    assert.ok(!contactTasks({ ...c, tpt_status: s }, { indexStart: START, today: "2026-10-21" }).some((t) => t.step === "C"), s);
  }
});

test("D: นับจากวันคัดกรอง เฉพาะผล 'ไม่ป่วย' แสดงนัดถัดไปนัดเดียว", () => {
  const base = { invest_date: "2026-10-03", screen_date: "2026-10-05", screen_result: "ไม่ป่วย" };
  const ctx = { indexStart: START, today: "2026-10-21" };
  assert.deepEqual(contactTasks(contact(base), ctx), [
    { step: "D", what: "ติดตาม 6 เดือน (ซักอาการ + CXR)", due: "2027-04-05", status: "upcoming" },
  ]);
  assert.equal(contactTasks(contact({ ...base, fu6_date: "2027-04-05" }), ctx)[0].due, "2027-10-05");
  // ใกล้ชิด: 12/24 เดือน
  assert.equal(contactTasks(contact({ ...base, contact_type: "close" }), ctx)[0].what, "ติดตาม 12 เดือน (ซักอาการ + CXR)");
  // ไม่มีวันคัดกรอง → ใช้วัน CXR แล้ววันสอบสวน
  assert.equal(contactTasks(contact({ ...base, screen_date: null, cxr_date: "2026-10-04" }), ctx)[0].due, "2027-04-04");
  // ครบ 2 ปี
  const done = contact({ ...base, fu6_date: "x", fu12_date: "x", fu18_date: "x", fu24_date: "x" });
  assert.deepEqual(contactTasks(done, ctx), []);
});

test("ผู้สัมผัสป่วย TB → ไม่มีงาน; screened()", () => {
  const ctx = { indexStart: START, today: "2026-10-21" };
  assert.deepEqual(contactTasks(contact({ invest_date: "2026-10-03", screen_result: TB_RESULT }), ctx), []);
  assert.deepEqual(contactTasks(contact({ new_patient_id: "P00000000ab" }), ctx), []);
  assert.equal(screened(contact({ screen_result: "ไม่ป่วย" })), true);
  assert.equal(screened(contact({ screen_result: TB_RESULT })), true);
  assert.equal(screened(contact({ screen_result: "รอผล" })), false);
});

test("tptMonths ตามสูตรเดิม ไม่รู้จัก = 3 เดือน", () => {
  assert.deepEqual(["3HP", "1HP", "3HR", "4R", "6H"].map(tptMonths), [3, 1, 3, 4, 6]);
  assert.equal(tptMonths("9H"), 9);
  assert.equal(tptMonths("อื่นๆ"), 3);
  assert.equal(tptMonths(null), 3);
});

test("patientTasks: ยังไม่มีผู้สัมผัส + AFB 2 → 5 → 6 → สรุปผล ทีละรายการ", () => {
  const p = { start_date: START, diag_date: null, outcome: "กำลังรักษา" };
  const today = "2026-10-21";
  let ts = patientTasks(p, { contactCount: 0, followups: [], today });
  assert.deepEqual(ts, [
    { step: "A", what: "ระบุ/สอบสวนผู้สัมผัส", due: "2026-10-08", status: "overdue" },
    { step: "4", what: "AFB เดือน 2", due: "2026-12-01", status: "upcoming" },
  ]);
  const afb = (m: number, result: string | null) => ({ month_no: m, test: "AFB" as const, result });
  ts = patientTasks(p, { contactCount: 2, followups: [afb(2, "NEG"), { month_no: 2, test: "CXR", result: "abnormal" }], today });
  assert.deepEqual(ts.map((t) => t.what), ["AFB เดือน 5"]);
  ts = patientTasks(p, { contactCount: 2, followups: [afb(2, "NEG"), afb(5, " "), afb(6, null)], today });
  assert.deepEqual(ts.map((t) => t.what), ["AFB เดือน 5"]); // ช่องว่าง = ยังไม่ได้ผล
  ts = patientTasks(p, { contactCount: 2, followups: [afb(2, "NEG"), afb(5, "NEG"), afb(6, "NEG")], today });
  assert.deepEqual(ts, [{ step: "5", what: "สรุปผลการรักษา", due: "2027-04-01", status: "upcoming" }]);
});

test("patientTasks: สรุปผลแล้ว หรือไม่มีวันเริ่มยา/วินิจฉัย → ไม่มีงาน", () => {
  const ctx = { contactCount: 0, followups: [], today: "2026-10-21" };
  assert.deepEqual(patientTasks({ start_date: START, diag_date: null, outcome: "รักษาครบ" }, ctx), []);
  assert.deepEqual(patientTasks({ start_date: null, diag_date: null, outcome: "กำลังรักษา" }, ctx), []);
  assert.equal(patientTasks({ start_date: null, diag_date: START, outcome: "กำลังรักษา" }, ctx)[0].due, "2026-10-08");
});
