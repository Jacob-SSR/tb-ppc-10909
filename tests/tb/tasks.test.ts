import assert from "node:assert/strict";
import { test } from "node:test";
import { TB_RESULT } from "../../lib/tb/constants.ts";
import { contactTasks, patientTasks, regimenMonths, taskStatus, tptMonths } from "../../lib/tb/tasks.ts";
import { contact } from "./fixtures.ts";

const START = "2026-10-01"; // ผู้ป่วย index เริ่มยา
const keys = (ts: { key: string }[]) => ts.map((t) => t.key);

test("taskStatus", () => {
  assert.equal(taskStatus(null, "2026-10-21"), "unscheduled");
  assert.equal(taskStatus("2026-10-20", "2026-10-21"), "overdue");
  assert.equal(taskStatus("2026-10-21", "2026-10-21"), "due_soon");
  assert.equal(taskStatus("2026-10-28", "2026-10-21"), "due_soon");
  assert.equal(taskStatus("2026-10-29", "2026-10-21"), "upcoming");
});

test("ผู้สัมผัสใหม่: A ภายใน 7 วัน, B ภายใน 14 วัน, D นัดแรก", () => {
  const ts = contactTasks(contact(), { indexStartDate: START, today: "2026-10-05" });
  assert.deepEqual(keys(ts), ["A", "B", "D:6"]);
  assert.equal(ts[0].due, "2026-10-08");
  assert.equal(ts[1].due, "2026-10-15");
  assert.equal(ts[2].due, "2027-04-01");
  assert.equal(ts[0].status, "due_soon");
});

test("A/B เลยกำหนด → overdue", () => {
  const ts = contactTasks(contact(), { indexStartDate: START, today: "2026-10-21" });
  assert.equal(ts.find((t) => t.key === "A")!.status, "overdue");
  assert.equal(ts.find((t) => t.key === "B")!.status, "overdue");
});

test("ไม่รู้วันเริ่มยาของ index → unscheduled", () => {
  const ts = contactTasks(contact(), { indexStartDate: null, today: "2026-10-21" });
  assert.ok(ts.every((t) => t.status === "unscheduled" && t.due === null));
});

test("คัดกรองแล้วเข้าเกณฑ์ TPT ยังไม่เริ่ม → C:start", () => {
  const c = contact({ investigate_date: "2026-10-03", screen_date: "2026-10-05", tpt_eligible: 1 });
  assert.deepEqual(keys(contactTasks(c, { indexStartDate: START, today: "2026-10-21" })), ["C:start", "D:6"]);
  // ไม่เข้าเกณฑ์ → ไม่มี C
  const no = contact({ investigate_date: "2026-10-03", screen_date: "2026-10-05", tpt_eligible: 0 });
  assert.deepEqual(keys(contactTasks(no, { indexStartDate: START, today: "2026-10-21" })), ["D:6"]);
});

test("TPT นัดรายเดือนตามสูตร แล้วสรุปผล", () => {
  const c = contact({
    investigate_date: "2026-10-03", screen_date: "2026-10-05", tpt_eligible: 1,
    tpt_regimen: "3HP", tpt_start_date: "2026-10-10",
  });
  const ctx = { indexStartDate: START, today: "2026-10-21" };
  let c1 = contactTasks(c, ctx).find((t) => t.step === "C")!;
  assert.equal(c1.key, "C:tpt-1");
  assert.equal(c1.label, "นัด TPT เดือนที่ 1/3");
  assert.equal(c1.due, "2026-11-10");

  c1 = contactTasks(c, { ...ctx, tptVisitDates: ["2026-10-10", "2026-11-10"] }).find((t) => t.step === "C")!;
  assert.equal(c1.key, "C:tpt-2"); // visit วันเริ่มยาไม่นับ
  assert.equal(c1.due, "2026-12-10");

  c1 = contactTasks(c, { ...ctx, tptVisitDates: ["2026-11-10", "2026-12-10", "2027-01-10"] }).find((t) => t.step === "C")!;
  assert.equal(c1.key, "C:end");

  // กินครบ / มีวันสิ้นสุด → ไม่มี C
  assert.equal(contactTasks({ ...c, tpt_status: "กินครบ" }, ctx).some((t) => t.step === "C"), false);
  assert.equal(contactTasks({ ...c, tpt_end_date: "2027-01-10" }, ctx).some((t) => t.step === "C"), false);
  // ไม่รู้สูตร
  assert.equal(contactTasks({ ...c, tpt_regimen: null }, ctx).find((t) => t.step === "C")!.key, "C:regimen");
});

test("D: ร่วมบ้าน 6/12/18/24, ใกล้ชิด 12/24 — โชว์นัดถัดไป + ที่เลยกำหนด", () => {
  const base = { investigate_date: "2026-10-03", screen_date: "2026-10-05" };
  const ctx = { indexStartDate: START, today: "2027-10-15" };
  // ร่วมบ้าน ยังไม่ติดตามเลย: 6 และ 12 เดือนเลยแล้ว → โชว์ทั้งสอง ไม่โชว์ 18/24
  assert.deepEqual(keys(contactTasks(contact(base), ctx)), ["D:6", "D:12"]);
  // ติดตาม 6 แล้ว
  assert.deepEqual(keys(contactTasks(contact({ ...base, fu6_date: "2027-04-01" }), ctx)), ["D:12"]);
  // ใกล้ชิดไม่มีนัด 6 เดือน
  assert.deepEqual(keys(contactTasks(contact({ ...base, contact_type: "close" }), ctx)), ["D:12"]);
  // ครบหมด
  const done = contact({ ...base, fu6_date: "x", fu12_date: "x", fu18_date: "x", fu24_date: "x" });
  assert.deepEqual(keys(contactTasks(done, ctx)), []);
});

test("ผู้สัมผัสป่วย TB: เหลืองานเดียวคือระบุที่รักษา", () => {
  const ctx = { indexStartDate: START, today: "2026-10-21" };
  assert.deepEqual(keys(contactTasks(contact({ screen_date: "2026-10-05", screen_result: TB_RESULT }), ctx)), ["TB"]);
  assert.deepEqual(contactTasks(contact({ screen_result: TB_RESULT, tb_treat_place: "รพ.บุรีรัมย์" }), ctx), []);
  assert.deepEqual(contactTasks(contact({ new_patient_id: "P00000000ab" }), ctx), []);
});

test("tptMonths / regimenMonths", () => {
  assert.equal(tptMonths("3HP"), 3);
  assert.equal(tptMonths("1HP"), 1);
  assert.equal(tptMonths("6Lfx"), 6);
  assert.equal(tptMonths("12H"), 12);
  assert.equal(tptMonths(""), null);
  assert.equal(tptMonths("HP"), null);

  assert.equal(regimenMonths("2IRZE + 4IR"), 6);
  assert.equal(regimenMonths("2IRZE + 7IR"), 9);
  assert.equal(regimenMonths("2IRZE/10IR"), 12);
  assert.equal(regimenMonths("3IRZE/4IR"), 7);
  assert.equal(regimenMonths("2IRZE/4-7IR"), 9);
  assert.equal(regimenMonths("9HZE"), 9);
  assert.equal(regimenMonths("12IEL, 2IRZE + 4IR"), 6);
  assert.equal(regimenMonths("ELS, HRE, 2IRZE + 4IR"), 6);
  assert.equal(regimenMonths(null), 6);
  assert.equal(regimenMonths("ELS"), 6);
});

test("patientTasks: ยังไม่มีผู้สัมผัส, AFB 2/5/6, สรุปผล", () => {
  const p = { start_date: START, regimen: "2IRZE + 4IR", outcome: "กำลังรักษา" };
  const ts = patientTasks(p, { contactCount: 0, followups: [], today: "2026-10-21" });
  assert.deepEqual(keys(ts), ["P:no-contacts", "P:afb-2", "P:afb-5", "P:afb-6", "P:conclude"]);
  assert.equal(ts[0].due, "2026-10-08");
  assert.equal(ts[0].status, "overdue");
  assert.equal(ts[1].due, "2026-12-01");
  assert.equal(ts[4].due, "2027-04-01");

  const fu = [
    { month_no: 2, test_type: "AFB", test_date: "2026-12-01", result: "NEG" },
    { month_no: 2, test_type: "CXR", test_date: "2026-12-01", result: "abnormal" },
    { month_no: 5, test_type: "afb", test_date: null, result: null }, // ช่องว่าง ยังไม่ถือว่าทำ
  ];
  assert.deepEqual(keys(patientTasks(p, { contactCount: 3, followups: fu, today: "2026-10-21" })), ["P:afb-5", "P:afb-6", "P:conclude"]);
});

test("patientTasks: สรุปผลแล้วไม่มีงาน, outcome ว่าง = ยังรักษา", () => {
  const ctx = { contactCount: 0, followups: [], today: "2026-10-21" };
  assert.deepEqual(patientTasks({ start_date: START, regimen: null, outcome: "รักษาครบ" }, ctx), []);
  assert.ok(patientTasks({ start_date: START, regimen: null, outcome: null }, ctx).length > 0);
});
