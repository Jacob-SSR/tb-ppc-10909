// นัดหมาย (tb_appointments) กับ MySQL จริง — ข้อมูลสังเคราะห์
//   npm run test:db  (หลัง npm run migrate)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type mysql from "mysql2/promise";
import { closePools, tbDb, withTransaction } from "../../lib/db.ts";
import type { HosxpAppointment } from "../../lib/hosxp.ts";
import { redis } from "../../lib/redis.ts";
import { createAppointment, deleteAppointment, updateAppointment } from "../../lib/repo/appointments.ts";
import type { Actor } from "../../lib/repo/common.ts";
import { createVisit, deleteVisit, updateVisit } from "../../lib/repo/visits.ts";
import { newEntityId } from "../../lib/tb/ids.ts";
import { appointmentInput, visitInput } from "../../lib/validation.ts";
import { refreshHosxpAppointments } from "../../lib/worker/hosxpAppointments.ts";

let admin: Actor;
let unit: Actor;
let otherUnit: Actor;
let patientId: string;
let contactId: string;

type R = mysql.RowDataPacket & Record<string, unknown>;
const appt = async (id: string) => (await tbDb.query<R[]>("SELECT * FROM tb_appointments WHERE id = ?", [id]))[0][0];
const tx = <T>(fn: (c: mysql.PoolConnection) => Promise<T>) => withTransaction(fn);

async function user(unitId: number, role: "admin" | "unit"): Promise<Actor> {
  const [r] = await tbDb.query<mysql.ResultSetHeader>("INSERT INTO tb_users SET ?", [{
    unit_id: unitId, username: `appt_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, display_name: "ทดสอบนัด", password_hash: "$2b$10$x",
  }]);
  return { id: r.insertId, role, unitId };
}

before(async () => {
  const [units] = await tbDb.query<R[]>("SELECT id, role FROM tb_units ORDER BY id");
  const adminUnit = Number(units.find((u) => u.role === "admin")!.id);
  const [u1, u2] = units.filter((u) => u.role === "unit").map((u) => Number(u.id));
  admin = await user(adminUnit, "admin");
  unit = await user(u1, "unit");
  otherUnit = await user(u2, "unit");
  patientId = newEntityId("P");
  await tbDb.query("INSERT INTO tb_patients SET ?", [{ id: patientId, fy: 2570, name: "ผู้ป่วยนัด ทดสอบ", hn: "APPT1", start_date: "2026-10-01" }]);
  contactId = newEntityId("C");
  await tbDb.query("INSERT INTO tb_contacts SET ?", [{ id: contactId, patient_id: patientId, name: "ผู้สัมผัสนัด", contact_type: "household", unit_id: u1 }]);
});

after(async () => {
  await redis.quit();
  await closePools();
});

const input = (o: Record<string, unknown>) => appointmentInput.parse({ appt_date: "2026-11-02", purpose: "ตรวจเสมหะ (AFB)", ...o });

test("เพิ่ม/แก้/ลบนัด + สิทธิ์ตาม §5.1 + optimistic lock", async () => {
  const { id } = await tx((c) => createAppointment(c, input({ patient_id: patientId, appt_time: "8:30" }), admin));
  let a = await appt(id);
  assert.equal(a.status, "scheduled");
  assert.equal(a.appt_time, "08:30:00");
  assert.equal(a.source, "manual");

  await assert.rejects(tx((c) => createAppointment(c, input({ patient_id: patientId }), unit)), { status: 403 });
  const c1 = await tx((c) => createAppointment(c, input({ contact_id: contactId, place: "รพ.สต." }), unit));
  await assert.rejects(tx((c) => updateAppointment(c, c1.id, 1, input({ contact_id: contactId, status: "done" }), otherUnit)), { status: 403 });

  // เลื่อนนัด → version เพิ่ม, ใช้ version เก่าซ้ำ = 409
  const r = await tx((c) => updateAppointment(c, id, 1, input({ patient_id: patientId, appt_date: "2026-11-09", appt_time: "08:30" }), admin));
  assert.equal(r.version, 2);
  await assert.rejects(tx((c) => updateAppointment(c, id, 1, input({ patient_id: patientId, status: "cancelled" }), admin)), { status: 409 });
  a = await appt(id);
  assert.equal(a.appt_date, "2026-11-09");

  // ลบ: unit ไม่ได้ (ใช้ยกเลิก), admin ได้ (soft delete) + ประวัติการแก้ไข
  await assert.rejects(tx((c) => deleteAppointment(c, c1.id, undefined, unit)), { status: 403 });
  await tx((c) => updateAppointment(c, c1.id, undefined, input({ contact_id: contactId, place: "รพ.สต.", status: "cancelled" }), unit));
  await tx((c) => deleteAppointment(c, id, 2, admin));
  assert.ok((await appt(id)).deleted_at);
  const [log] = await tbDb.query<R[]>("SELECT action, changes FROM tb_audit_log WHERE entity = 'appointment' AND entity_id = ? ORDER BY id", [id]);
  assert.deepEqual(log.map((l) => l.action), ["add", "save", "delete"]);
  assert.deepEqual((log[1].changes as Record<string, unknown>).appt_date, ["2026-11-02", "2026-11-09"]);
});

test("บันทึกรายครั้ง: next_appt → นัด, บันทึกใหม่ → มาตามนัด, แก้/ลบบันทึก → นัดตาม", async () => {
  const v = (o: Record<string, unknown>) => visitInput.parse({ contact_id: contactId, visit_type: "DOT / เยี่ยมบ้าน", detail: "ทดสอบ", ...o });
  const v1 = await tx((c) => createVisit(c, v({ visit_date: "2026-10-10", next_appt: "2026-10-24" }), unit));
  const [[a1]] = await tbDb.query<R[]>("SELECT * FROM tb_appointments WHERE visit_id = ?", [v1.id]);
  assert.equal(a1.appt_date, "2026-10-24");
  assert.equal(a1.source, "visit");
  assert.equal(a1.purpose, "DOT / เยี่ยมบ้าน");

  // แก้วันนัดในบันทึก → นัดเลื่อนตาม
  await tx((c) => updateVisit(c, v1.id, v({ visit_date: "2026-10-10", next_appt: "2026-10-25" }), unit));
  assert.equal((await appt(a1.id as string)).appt_date, "2026-10-25");

  // มาตามนัด (บันทึกใหม่วันที่ 25) → นัดเดิม = มาตามนัด, นัดครั้งถัดไป = นัดใหม่
  const v2 = await tx((c) => createVisit(c, v({ visit_date: "2026-10-25", next_appt: "2026-11-25" }), unit));
  assert.equal((await appt(a1.id as string)).status, "done");
  const [[a2]] = await tbDb.query<R[]>("SELECT * FROM tb_appointments WHERE visit_id = ?", [v2.id]);
  assert.equal(a2.status, "scheduled");

  // ลบบันทึก → นัดค้างจากบันทึกนั้นถูกลบ
  await tx((c) => deleteVisit(c, v2.id, admin));
  assert.ok((await appt(a2.id as string)).deleted_at);
});

test("นัดจาก HOSxP: ดึงซ้ำไม่เพิ่มซ้ำ + อัปเดตทุกเช้า (มาแล้ว / ยกเลิก / ถูกลบ / เลื่อน)", async () => {
  const oid = () => String(Math.floor(Math.random() * 1e9));
  const [o1, o2, o3, o4] = [oid(), oid(), oid(), oid()];
  const mk = (o: string, date = "2026-12-01") => tx((c) => createAppointment(c, input({ patient_id: patientId, appt_date: date, hosxp_oapp_id: o, hosxp_status: "1" }), admin));
  const first = await mk(o1);
  const again = await mk(o1, "2026-12-02");
  assert.equal(again.id, first.id);
  assert.equal(again.existing, true);
  assert.equal((await appt(first.id)).appt_date, "2026-12-02");
  assert.equal((await appt(first.id)).source, "hosxp");
  await assert.rejects(tx((c) => createAppointment(c, input({ contact_id: contactId, hosxp_oapp_id: oid() }), unit)), { status: 403 });

  const ids = { came: first.id, cancel: (await mk(o2)).id, gone: (await mk(o3)).id, moved: (await mk(o4)).id };
  const h = (id: string, o: Partial<HosxpAppointment>): [string, HosxpAppointment] => [id, {
    oapp_id: id, date: "2026-12-01", time: null, clinic: "", place: "", doctor: "", cause: "", note: "", status: "1", active: true, came: false, ...o,
  }];
  const fake = async () => new Map([
    h(o1, { came: true, date: "2026-12-02" }), h(o2, { status: "3", active: false }), h(o4, { date: "2026-12-15", time: "09:00:00" }),
  ]);
  const r = await refreshHosxpAppointments(tbDb, fake);
  assert.ok(r.updated >= 4);
  assert.equal((await appt(ids.came)).status, "done");
  assert.equal((await appt(ids.cancel)).status, "cancelled");
  assert.equal((await appt(ids.cancel)).hosxp_status, "3");
  assert.equal((await appt(ids.gone)).status, "cancelled");
  const moved = await appt(ids.moved);
  assert.deepEqual([moved.status, moved.appt_date, moved.appt_time], ["scheduled", "2026-12-15", "09:00:00"]);
});
