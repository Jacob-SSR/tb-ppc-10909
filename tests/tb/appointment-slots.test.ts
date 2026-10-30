import assert from "node:assert/strict";
import { test } from "node:test";
import { APPT_PERIODS, appointmentSlots, inAppointmentSlot } from "../../lib/tb/appointmentSlots.ts";
import { appointmentInput } from "../../lib/validation.ts";

test("ช่วงนัด 30 นาทีครอบคลุม 08:00–19:59 โดยไม่ซ้อนกัน", () => {
  const slots = APPT_PERIODS.flatMap(appointmentSlots);
  assert.equal(slots.length, 24);
  assert.equal(slots[0].start, "08:00");
  assert.equal(slots.at(-1)?.end, "19:59");
  for (const [i, slot] of slots.entries()) {
    assert.ok(inAppointmentSlot(`${slot.start}:00`, slot.start, slot.end));
    assert.ok(inAppointmentSlot(`${slot.end}:59`, slot.start, slot.end));
    if (i) assert.ok(slots[i - 1].end < slot.start);
  }
  assert.equal(inAppointmentSlot("08:30:00", "08:00", "08:29"), false);
  assert.equal(inAppointmentSlot(null, "08:00", "08:29"), false);
});

const base = { patient_id: "P0123456789", appt_date: "2026-11-01", purpose: "รับยา", appt_time: "8:30" };
test("ข้อมูลนัดใหม่: เวลา สิ้นสุด ห้องตรวจ จุดติดต่อ คำแนะนำ และ Telemed", () => {
  const a = appointmentInput.parse({ ...base, appt_time_end: "08:59", department: " ห้องตรวจ 1 ", contact_point: "จุดนัด", instructions: "นำบัตรประชาชน\nนำยามาด้วย", telemed: true });
  assert.equal(a.appt_time, "08:30:00");
  assert.equal(a.appt_time_end, "08:59:00");
  assert.equal(a.department, "ห้องตรวจ 1");
  assert.equal(a.telemed, true);
  assert.equal(a.instructions, "นำบัตรประชาชน\nนำยามาด้วย");
  assert.equal(appointmentInput.safeParse({ ...base, appt_time_end: "08:29" }).success, false);
  assert.equal(appointmentInput.safeParse({ ...base, appt_time: null, appt_time_end: "08:59" }).success, false);
  assert.equal(appointmentInput.safeParse({ ...base, telemed: "false" }).success, false);
  assert.equal(appointmentInput.safeParse({ ...base, instructions: "x".repeat(2001) }).success, false);
  assert.equal(appointmentInput.parse(base).instructions, undefined);
});
