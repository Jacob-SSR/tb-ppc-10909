import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  addMonths,
  ageOn,
  diffDays,
  formatThaiDate,
  fyOf,
  fyRange,
  inRange,
  periodRange,
  quarterOf,
  quarterRange,
  todayBangkok,
  toIso,
} from "../../lib/tb/dates.ts";

test("fyOf: ต.ค. ขึ้นปีงบใหม่", () => {
  assert.equal(fyOf("2025-09-30"), 2568);
  assert.equal(fyOf("2025-10-01"), 2569);
  assert.equal(fyOf("2026-01-15"), 2569);
  assert.equal(fyOf("2026-09-30"), 2569);
  assert.equal(fyOf("2026-10-21"), 2570);
});

test("quarterOf: Q1 ต.ค.–ธ.ค. … Q4 ก.ค.–ก.ย.", () => {
  assert.equal(quarterOf("2025-10-01"), 1);
  assert.equal(quarterOf("2025-12-31"), 1);
  assert.equal(quarterOf("2026-01-01"), 2);
  assert.equal(quarterOf("2026-03-31"), 2);
  assert.equal(quarterOf("2026-04-01"), 3);
  assert.equal(quarterOf("2026-06-30"), 3);
  assert.equal(quarterOf("2026-07-01"), 4);
  assert.equal(quarterOf("2026-09-30"), 4);
});

test("fyRange / quarterRange / periodRange", () => {
  assert.deepEqual(fyRange(2569), { from: "2025-10-01", to: "2026-09-30" });
  assert.deepEqual(quarterRange(2569, 1), { from: "2025-10-01", to: "2025-12-31" });
  assert.deepEqual(quarterRange(2569, 2), { from: "2026-01-01", to: "2026-03-31" });
  assert.deepEqual(quarterRange(2569, 3), { from: "2026-04-01", to: "2026-06-30" });
  assert.deepEqual(quarterRange(2569, 4), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(periodRange(2569, 0), fyRange(2569));
  assert.deepEqual(periodRange(2569, 3), quarterRange(2569, 3));
  assert.deepEqual(periodRange(2569, 3, "ytd"), { from: "2025-10-01", to: "2026-06-30" });
  // ทุกวันในปีงบต้องตกไตรมาสที่ quarterOf บอก และ fyOf ตรงกัน
  for (let d = "2025-10-01"; d <= "2026-09-30"; d = addDays(d, 1)) {
    assert.equal(fyOf(d), 2569, d);
    assert.ok(inRange(d, quarterRange(2569, quarterOf(d))), d);
  }
});

test("toIso: dd/mm/yyyy พ.ศ. และ ค.ศ.", () => {
  assert.equal(toIso("19/04/2569"), "2026-04-19");
  assert.equal(toIso("1/2/2569"), "2026-02-01");
  assert.equal(toIso("19/04/2026"), "2026-04-19");
  assert.equal(toIso("19-04-2569"), "2026-04-19");
  assert.equal(toIso(" 29/02/2567 "), "2024-02-29");
});

test("toIso: ISO / ISO มีเวลา / ปี พ.ศ.", () => {
  assert.equal(toIso("2026-04-19"), "2026-04-19");
  assert.equal(toIso("2026-4-9"), "2026-04-09");
  assert.equal(toIso("2569-04-19 00:00:00"), "2026-04-19");
  assert.equal(toIso("2026-04-19 13:45:00"), "2026-04-19");
  // instant UTC → วันที่ตามเวลาไทย (เที่ยงคืนไทย = 17:00Z ของวันก่อน)
  assert.equal(toIso("2026-03-01T17:00:00.000Z"), "2026-03-02");
  assert.equal(toIso("2026-03-01T10:00:00+07:00"), "2026-03-01");
});

test("toIso: Excel serial และ Date", () => {
  assert.equal(toIso(45658), "2025-01-01");
  assert.equal(toIso("45658"), "2025-01-01");
  assert.equal(toIso(45658.75), "2025-01-01");
  assert.equal(toIso(new Date("2026-10-20T17:30:00Z")), "2026-10-21");
});

test("toIso: ค่าว่างหรือวันที่ไม่จริง → null", () => {
  for (const v of [null, undefined, "", "  ", "-", "abc", "31/02/2569", "2026-13-01", "00/01/2569", 0, -5, NaN, {}, new Date("x")]) {
    assert.equal(toIso(v), null, String(v));
  }
});

test("addDays / addMonths / diffDays", () => {
  assert.equal(addDays("2026-02-27", 2), "2026-03-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2025-11-15", 2), "2026-01-15");
  assert.equal(addMonths("2026-03-15", -3), "2025-12-15");
  assert.equal(addMonths("2025-10-01", 24), "2027-10-01");
  assert.equal(diffDays("2026-10-14", "2026-10-21"), 7);
  assert.equal(diffDays("2026-10-21", "2026-10-14"), -7);
  assert.equal(diffDays("2026-03-28", "2026-03-30"), 2);
});

test("ageOn", () => {
  assert.equal(ageOn("1980-10-21", "2026-10-21"), 46);
  assert.equal(ageOn("1980-10-22", "2026-10-21"), 45);
});

test("formatThaiDate แสดง พ.ศ.", () => {
  assert.equal(formatThaiDate("2026-10-21"), "21/10/2569");
  assert.equal(formatThaiDate("2026-01-05", "long"), "5 ม.ค. 2569");
  assert.equal(formatThaiDate(null), "");
  assert.equal(formatThaiDate("19/04/2569"), "");
});

test("todayBangkok ใช้เวลาไทย", () => {
  assert.equal(todayBangkok(new Date("2026-10-20T16:59:59Z")), "2026-10-20");
  assert.equal(todayBangkok(new Date("2026-10-20T17:00:00Z")), "2026-10-21");
});
