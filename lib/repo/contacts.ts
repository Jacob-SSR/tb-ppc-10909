// lib/repo/contacts.ts — ผู้สัมผัส + แปลงผู้สัมผัสที่ป่วยเป็นผู้ป่วยใหม่
// user unit: เพิ่ม/แก้ได้เฉพาะ unit_id ของหน่วยตัวเอง (ไม่ระบุ = หน่วยตัวเอง), ลบ/แปลง = admin (§5.1)
import { type Changes, diff, type Queryable, writeAudit } from "../audit.ts";
import { badRequest, forbidden } from "../errors.ts";
import { enqueue } from "../outbox.ts";
import { patientDraftFromContact } from "../tb/contacts.ts";
import { todayBangkok } from "../tb/dates.ts";
import { newEntityId } from "../tb/ids.ts";
import { CONTACT_KEYS, type ContactInput, patientInput } from "../validation.ts";
import { type Actor, assertVersion, lockRow, pick, type Row } from "./common.ts";
import { createPatient } from "./patients.ts";

async function activePatient(db: Queryable, id: string): Promise<Row> {
  const [rows] = await db.query<Row[]>("SELECT id, hn, unit_id FROM tb_patients WHERE id = ? AND deleted_at IS NULL", [id]);
  if (!rows[0]) throw badRequest("ไม่พบผู้ป่วย index");
  return rows[0];
}

/** หน่วยรับผิดชอบตามสิทธิ์: unit ใช้หน่วยตัวเองเท่านั้น, admin ต้องระบุ (ไม่ระบุใช้หน่วยของผู้ป่วย index) */
function resolveUnit(input: ContactInput, actor: Actor, patient: Row): number {
  if (actor.role !== "admin") {
    const u = input.unit_id ?? actor.unitId;
    if (u !== actor.unitId) throw forbidden("กำหนด รพ.สต.รับผิดชอบเป็นหน่วยอื่นไม่ได้");
    return u!;
  }
  const u = input.unit_id ?? (patient.unit_id as number | null);
  if (!u) throw badRequest("กรุณาเลือก รพ.สต.รับผิดชอบ");
  return u;
}

export async function createContact(
  db: Queryable, input: ContactInput, actor: Actor, opts: { id?: string } = {},
): Promise<{ id: string }> {
  const patient = await activePatient(db, input.patient_id);
  const id = opts.id ?? newEntityId("C");
  const row = { ...pick(input, CONTACT_KEYS), unit_id: resolveUnit(input, actor, patient) };
  const cols = Object.keys(row);
  await db.query(
    `INSERT INTO tb_contacts (id, ${cols.join(", ")}, created_by, updated_by) VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?)`,
    [id, ...cols.map((c) => (row as Record<string, unknown>)[c] ?? null), actor.id, actor.id],
  );
  await writeAudit(db, {
    userId: actor.id, action: "add", entity: "contact", entityId: id, patientId: input.patient_id, changes: diff(null, row), ip: actor.ip,
  });
  await enqueue(db, "contact", id);
  return { id };
}

export async function updateContact(
  db: Queryable, id: string, version: number | undefined, input: ContactInput, actor: Actor,
  opts: { skipIfUnchanged?: boolean } = {},
): Promise<{ id: string; version: number; changed: boolean }> {
  const cur = await lockRow(db, "tb_contacts", id, "ผู้สัมผัส");
  assertVersion(cur, version);
  if (actor.role !== "admin") {
    if (cur.unit_id !== actor.unitId) throw forbidden("แก้ไขได้เฉพาะผู้สัมผัสในเขตรับผิดชอบของหน่วยท่าน");
    if (input.patient_id !== cur.patient_id) throw forbidden("เปลี่ยนผู้ป่วย index ได้เฉพาะทีม รพ.");
  }
  const patient = await activePatient(db, input.patient_id);
  const row = { ...pick(input, CONTACT_KEYS), unit_id: resolveUnit(input, actor, patient) };
  const changes: Changes = diff(cur, row);
  const cols = Object.keys(changes);
  if (opts.skipIfUnchanged && !cols.length) return { id, version: Number(cur.version), changed: false };
  const newVersion = Number(cur.version) + 1;
  await db.query(
    `UPDATE tb_contacts SET ${cols.map((c) => `${c} = ?, `).join("")}version = ?, updated_by = ? WHERE id = ?`,
    [...cols.map((c) => (row as Record<string, unknown>)[c] ?? null), newVersion, actor.id, id],
  );
  await writeAudit(db, {
    userId: actor.id, action: "save", entity: "contact", entityId: id, patientId: input.patient_id,
    changes: cols.length ? changes : { บันทึก: [null, "ไม่มีการเปลี่ยนแปลง"] }, ip: actor.ip,
  });
  await enqueue(db, "contact", id);
  return { id, version: newVersion, changed: true };
}

export async function deleteContact(db: Queryable, id: string, version: number | undefined, actor: Actor): Promise<void> {
  if (actor.role !== "admin") throw forbidden("เฉพาะทีม รพ. ลบข้อมูลได้");
  const cur = await lockRow(db, "tb_contacts", id, "ผู้สัมผัส");
  assertVersion(cur, version);
  await db.execute("UPDATE tb_contacts SET deleted_at = NOW(), version = version + 1, updated_by = ? WHERE id = ?", [actor.id, id]);
  await writeAudit(db, {
    userId: actor.id, action: "delete", entity: "contact", entityId: id, patientId: cur.patient_id as string,
    changes: { name: [cur.name, null] }, ip: actor.ip,
  });
  await enqueue(db, "contact", id);
}

/** ผู้สัมผัสป่วย → สร้างผู้ป่วยใหม่ แล้วผูก new_patient_id (transaction เดียวกับผู้เรียก) */
export async function convertContactToPatient(
  db: Queryable, contactId: string, startDate: string | null, actor: Actor,
): Promise<{ patientId: string }> {
  if (actor.role !== "admin") throw forbidden("เฉพาะทีม รพ. ลงทะเบียนผู้ป่วยใหม่ได้");
  const c = await lockRow(db, "tb_contacts", contactId, "ผู้สัมผัส");
  if (c.new_patient_id) throw badRequest("ลงทะเบียนเป็นผู้ป่วยแล้ว");
  const index = await activePatient(db, c.patient_id as string);
  const today = todayBangkok();
  if (!startDate && !c.screen_date) throw badRequest("กรุณาระบุวันเริ่มยา");

  const { patient, contactUpdate } = patientDraftFromContact(c as never, {
    id: newEntityId("P"), startDate, indexHn: index.hn as string | null, today,
  });
  // ผ่าน schema เดียวกับฟอร์ม — ช่องที่ไม่มีในร่างจะเป็น null, fy คำนวณใหม่จากวันที่
  const { id: newId, ...fields } = patient;
  await createPatient(db, patientInput.parse(fields), actor, { id: newId });

  await db.execute(
    "UPDATE tb_contacts SET new_patient_id = ?, screen_result = ?, version = version + 1, updated_by = ? WHERE id = ?",
    [contactUpdate.new_patient_id, contactUpdate.screen_result, actor.id, contactId],
  );
  await writeAudit(db, {
    userId: actor.id, action: "convert", entity: "contact", entityId: contactId, patientId: c.patient_id as string,
    changes: diff(c, contactUpdate), ip: actor.ip,
  });
  await enqueue(db, "contact", contactId);
  return { patientId: patient.id };
}
