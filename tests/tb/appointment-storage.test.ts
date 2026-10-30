import assert from "node:assert/strict";
import { test } from "node:test";
import type { Queryable } from "../../lib/audit.ts";
import { createAppointment, updateAppointment } from "../../lib/repo/appointments.ts";
import { appointmentInput } from "../../lib/validation.ts";

const actor = { id: 1, role: "admin" as const, unitId: 1 };
const input = { patient_id: "P0123456789", appt_date: "2026-11-01", appt_time: "08:30", purpose: "รับยา" };

test("SQL บันทึกครบทุกช่องด้วย placeholder และ audit; client เดิมไม่ล้างรายละเอียดใหม่", async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const cur = { ...appointmentInput.parse(input), id: "A0123456789", version: 1, telemed: 1, department: "ห้อง 1", instructions: "นำยามาด้วย", appt_time_end: "08:59:00", contact_point: "จุดนัด" };
  const run = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT * FROM tb_appointments")) return [[cur], []];
    if (sql.startsWith("SELECT id FROM tb_patients")) return [[{ id: input.patient_id }], []];
    return [[], []];
  };
  const db = { query: run, execute: run } as unknown as Queryable;
  await createAppointment(db, appointmentInput.parse({ ...input, telemed: true, appt_time_end: "08:59", department: "ห้อง 1", contact_point: "จุดนัด", instructions: "นำยามาด้วย" }), actor);
  const insert = calls.find((c) => c.sql.startsWith("INSERT INTO tb_appointments"))!;
  assert.equal((insert.sql.match(/\?/g) || []).length, insert.values.length);
  assert.deepEqual(insert.values.slice(-5), ["08:59:00", "ห้อง 1", "จุดนัด", "นำยามาด้วย", 1]);
  assert.ok(calls.some((c) => c.sql.startsWith("INSERT INTO tb_audit_log")));
  calls.length = 0;
  await updateAppointment(db, cur.id, 1, appointmentInput.parse({ ...input, status: "done" }), actor);
  const update = calls.find((c) => c.sql.startsWith("UPDATE tb_appointments"))!;
  assert.match(update.sql, /status = \?/);
  assert.doesNotMatch(update.sql, /instructions =|telemed =|department =|appt_time_end =|contact_point =/);
  calls.length = 0;
  await updateAppointment(db, cur.id, 1, appointmentInput.parse({ ...input, telemed: false, instructions: null }), actor);
  const cleared = calls.find((c) => c.sql.startsWith("UPDATE tb_appointments"))!;
  assert.match(cleared.sql, /telemed = \?/);
  assert.match(cleared.sql, /instructions = \?/);
});
