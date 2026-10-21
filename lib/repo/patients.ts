// lib/repo/patients.ts — ผู้ป่วย + ติดตามระหว่างรักษา (เฉพาะ admin ตาม §5.1)
import { type Changes, diff, type Queryable, writeAudit } from "../audit.ts";
import { badRequest, forbidden } from "../errors.ts";
import { enqueue } from "../outbox.ts";
import { fyOf } from "../tb/dates.ts";
import { newEntityId } from "../tb/ids.ts";
import { PATIENT_KEYS, type FollowupInputData, type PatientInput } from "../validation.ts";
import { type Actor, assertVersion, lockRow, pick, type Row } from "./common.ts";

function requireAdminActor(a: Actor) {
  if (a.role !== "admin") throw forbidden("เฉพาะทีม รพ. แก้ไขข้อมูลผู้ป่วยได้");
}

const FU_COLS = ["month_no", "test", "test_date", "result", "note"] as const;

const fuLabel = (f: Partial<FollowupInputData> | Row | undefined) =>
  f ? [`เดือน ${f.month_no}`, f.test, f.test_date, f.result].filter((x) => x !== null && x !== undefined && x !== "").join(" ") : null;

const hasData = (f: FollowupInputData) => !!(f.test_date || f.result || f.note);

/**
 * บันทึกช่องติดตามให้ตรงกับฟอร์ม: ช่องที่มีข้อมูล (หรือช่องที่เพิ่มเองเกิน 5) = upsert,
 * ช่องที่หายไปจากฟอร์ม/ช่องเริ่มต้นที่ว่าง = soft delete
 */
export async function syncFollowups(
  db: Queryable, patientId: string, incoming: FollowupInputData[], actorId: number | null,
): Promise<Changes> {
  const [rows] = await db.query<Row[]>(
    "SELECT * FROM tb_treatment_followups WHERE patient_id = ? AND deleted_at IS NULL FOR UPDATE",
    [patientId],
  );
  const existing = new Map(rows.map((r) => [Number(r.slot), r]));
  const keep = incoming.filter((f) => hasData(f) || f.slot > 5);
  const keepSlots = new Set(keep.map((f) => f.slot));
  const changes: Changes = {};

  for (const f of keep) {
    const cur = existing.get(f.slot);
    if (cur && Object.keys(diff(cur, f, FU_COLS)).length === 0) continue;
    await db.execute(
      `INSERT INTO tb_treatment_followups (patient_id, slot, month_no, test, test_date, result, note, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE month_no = VALUES(month_no), test = VALUES(test), test_date = VALUES(test_date),
         result = VALUES(result), note = VALUES(note), updated_by = VALUES(updated_by), deleted_at = NULL`,
      [patientId, f.slot, f.month_no, f.test, f.test_date, f.result, f.note, actorId],
    );
    changes[`ติดตามช่อง ${f.slot}`] = [fuLabel(cur), fuLabel(f)];
  }
  for (const [slot, cur] of existing) {
    if (keepSlots.has(slot)) continue;
    await db.execute(
      "UPDATE tb_treatment_followups SET deleted_at = NOW(), updated_by = ? WHERE patient_id = ? AND slot = ?",
      [actorId, patientId, slot],
    );
    changes[`ติดตามช่อง ${slot}`] = [fuLabel(cur), null];
  }
  return changes;
}

function rowFromInput(input: PatientInput) {
  const row = pick(input, PATIENT_KEYS) as Record<string, unknown>;
  // ปีงบตามวันเริ่มยา (ไม่มีใช้วันวินิจฉัย) — ไม่มีวันที่เลยใช้ปีงบที่ส่งมา (ข้อมูลนำเข้า)
  const d = input.start_date || input.diag_date;
  row.fy = d ? fyOf(d) : input.fy;
  if (!row.fy) throw badRequest("กรุณากรอกวันเริ่มยาหรือวันวินิจฉัย");
  return row;
}

async function nextSeq(db: Queryable, fy: number): Promise<number> {
  const [r] = await db.query<Row[]>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM tb_patients WHERE fy = ? AND deleted_at IS NULL", [fy]);
  return Number(r[0].n);
}

export async function createPatient(
  db: Queryable, input: PatientInput, actor: Actor, opts: { id?: string } & SaveOptions = {},
): Promise<{ id: string }> {
  requireAdminActor(actor);
  const id = opts.id ?? newEntityId("P");
  const row = rowFromInput(input);
  if (opts.keepInputFy && input.fy) row.fy = input.fy;
  if (row.seq == null && !opts.keepInputFy) row.seq = await nextSeq(db, row.fy as number);
  const cols = Object.keys(row);
  await db.query(
    `INSERT INTO tb_patients (id, ${cols.join(", ")}, created_by, updated_by) VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?)`,
    [id, ...cols.map((c) => row[c] ?? null), actor.id, actor.id],
  );
  const changes: Changes = { ...diff(null, row), ...(input.followups ? await syncFollowups(db, id, input.followups, actor.id) : {}) };
  await writeAudit(db, { userId: actor.id, action: "add", entity: "patient", entityId: id, patientId: id, changes, ip: actor.ip });
  await enqueue(db, "patient", id);
  if (input.followups?.length) await enqueue(db, "followup", id);
  return { id };
}

export interface SaveOptions {
  /** นำเข้า: ไม่มีอะไรเปลี่ยน → ไม่บันทึก version/audit/outbox (รันซ้ำไม่สร้างประวัติขยะ) */
  skipIfUnchanged?: boolean;
  /** ย้ายข้อมูลเดิม: ใช้ปีงบตามแท็บเดิมแทนการคำนวณจากวันเริ่มยา และไม่เติมลำดับให้เอง */
  keepInputFy?: boolean;
}

export async function updatePatient(
  db: Queryable, id: string, version: number | undefined, input: PatientInput, actor: Actor, opts: SaveOptions = {},
): Promise<{ id: string; version: number; changed: boolean }> {
  requireAdminActor(actor);
  const cur = await lockRow(db, "tb_patients", id, "ผู้ป่วย");
  assertVersion(cur, version);
  const row = rowFromInput(input);
  if (opts.keepInputFy && input.fy) row.fy = input.fy;
  if (row.seq == null) row.seq = cur.seq;
  const changes: Changes = diff(cur, row);
  const fuChanges = input.followups ? await syncFollowups(db, id, input.followups, actor.id) : {};
  if (opts.skipIfUnchanged && !Object.keys(changes).length && !Object.keys(fuChanges).length) {
    return { id, version: Number(cur.version), changed: false };
  }
  const newVersion = Number(cur.version) + 1;
  if (Object.keys(changes).length) {
    const cols = Object.keys(changes);
    await db.query(
      `UPDATE tb_patients SET ${cols.map((c) => `${c} = ?`).join(", ")}, version = ?, updated_by = ? WHERE id = ?`,
      [...cols.map((c) => row[c] ?? null), newVersion, actor.id, id],
    );
  } else {
    await db.execute("UPDATE tb_patients SET version = ?, updated_by = ? WHERE id = ?", [newVersion, actor.id, id]);
  }
  const all = { ...changes, ...fuChanges };
  await writeAudit(db, {
    userId: actor.id, action: "save", entity: "patient", entityId: id, patientId: id,
    changes: Object.keys(all).length ? all : { บันทึก: [null, "ไม่มีการเปลี่ยนแปลง"] }, ip: actor.ip,
  });
  await enqueue(db, "patient", id);
  if (Object.keys(fuChanges).length) await enqueue(db, "followup", id);
  return { id, version: newVersion, changed: true };
}

export async function deletePatient(db: Queryable, id: string, version: number | undefined, actor: Actor): Promise<void> {
  requireAdminActor(actor);
  const cur = await lockRow(db, "tb_patients", id, "ผู้ป่วย");
  assertVersion(cur, version);
  const [c] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM tb_contacts WHERE patient_id = ? AND deleted_at IS NULL", [id]);
  if (Number(c[0].n) > 0) throw badRequest("ผู้ป่วยรายนี้ยังมีผู้สัมผัสอยู่ กรุณาลบผู้สัมผัสก่อน");
  await db.execute("UPDATE tb_patients SET deleted_at = NOW(), version = version + 1, updated_by = ? WHERE id = ?", [actor.id, id]);
  await writeAudit(db, {
    userId: actor.id, action: "delete", entity: "patient", entityId: id, patientId: id,
    changes: { name: [cur.name, null], hn: [cur.hn, null] }, ip: actor.ip,
  });
  await enqueue(db, "patient", id);
}

