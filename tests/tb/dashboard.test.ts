import assert from "node:assert/strict";
import { test } from "node:test";
import { computeIndicators, countBy, monthlyRegistrations } from "../../lib/tb/dashboard.ts";

const p = (start_date: string, patient_type = "NEW", outcome = "กำลังรักษา") => ({ start_date, diag_date: null, patient_type, outcome });

const patients = [
  p("2025-10-05", "NEW", "หาย"),
  p("2025-11-10", "Relapse", "รักษาครบ"),
  p("2025-12-20", "Transfer in", "เสียชีวิต"),
  p("2026-01-15", "NEW", "กำลังรักษา"),
  p("2026-04-01", "NEW", "ขาดยา"),
  p("2026-10-02", "NEW"), // ปีงบถัดไป
];

test("ไตรมาสที่ยังไม่ตั้งเป้า → ยังไม่ตั้งเป้า (ไม่ใช่ 0%)", () => {
  const { results, inPeriod } = computeIndicators(patients, [], 2569, 1);
  assert.equal(inPeriod, 3);
  assert.equal(results.case_finding.actual, 2);
  assert.equal(results.case_finding.progress.label, "ยังไม่ตั้งเป้า");
  assert.equal(results.case_finding.pass, null);
  assert.equal(results.coverage.actual, null);
  assert.ok(results.coverage.note);
});

test("Q1: A/B, coverage, success, death", () => {
  const targets = [
    { fy: 2569, quarter: 1 as const, indicator: "case_finding", target: "4.00", unit: "cases" as const },
    { fy: 2569, quarter: 1 as const, indicator: "coverage", target: 88, unit: "percent" as const },
    { fy: 2569, quarter: 1 as const, indicator: "success_rate", target: 88, unit: "percent" as const },
    { fy: 2569, quarter: 1 as const, indicator: "death_rate", target: 5, unit: "percent" as const },
    { fy: 2569, quarter: 0 as const, indicator: "case_finding", target: 20, unit: "cases" as const },
  ];
  const { results } = computeIndicators(patients, targets, 2569, 1);
  assert.equal(results.case_finding.progress.label, "2/4");
  assert.equal(results.case_finding.pass, false);
  assert.equal(results.coverage.actual, 50);
  assert.equal(results.coverage.pass, false);
  assert.equal(results.success_rate.actual, 66.7); // 2/3
  assert.equal(results.success_rate.numerator, 2);
  assert.equal(results.success_rate.denominator, 3);
  assert.equal(results.death_rate.actual, 33.3);
  assert.equal(results.death_rate.pass, false); // 33.3 > 5

  // ทั้งปี: 5 รายในปีงบ, NEW+Relapse 4, เป้าทั้งปี 20
  const year = computeIndicators(patients, targets, 2569, 0);
  assert.equal(year.inPeriod, 5);
  assert.equal(year.results.case_finding.progress.label, "4/20");
  // ทั้งปียังไม่ตั้งเป้า success → ไม่ใช้เป้า Q1 แทน
  assert.equal(year.results.success_rate.progress.notSet, true);
});

test("โหมดสะสม (ytd) ถึงสิ้นไตรมาส", () => {
  const q2 = computeIndicators(patients, [], 2569, 2);
  const ytd = computeIndicators(patients, [], 2569, 2, "ytd");
  assert.equal(q2.inPeriod, 1);
  assert.equal(ytd.inPeriod, 4);
});

test("countBy / monthlyRegistrations", () => {
  assert.deepEqual(countBy(patients, (x) => x.patient_type), [["NEW", 4], ["Relapse", 1], ["Transfer in", 1]]);
  assert.deepEqual(countBy([{ a: "" }, { a: null }], (x) => x.a), [["ไม่ระบุ", 2]]);
  const m = monthlyRegistrations(patients, 2569);
  assert.deepEqual(m, [1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0]);
});
