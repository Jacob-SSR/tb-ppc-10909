// lib/repo/importer.ts — นำเข้าแถวจาก Excel / Google Sheet เดิม (ผ่าน validation + audit เหมือนคีย์ปกติ)
//
// mode "excel"  : admin นำเข้าไฟล์ (importRows เดิม) — จับคู่ผู้ป่วยด้วย id หรือ (ปีงบ + HN),
//                 ผู้สัมผัสด้วย id หรือ (ผู้ป่วย index + ชื่อ); ช่องว่างในไฟล์ไม่ลบค่าเดิม
// mode "migrate": ย้ายจาก Sheet ครั้งแรก (§8) — คง id เดิม, upsert ตาม id (รันซ้ำได้),
//                 created_by = NULL + audit "migrate" เก็บ "แก้ไขโดย/เมื่อ" เดิม
//
// ทุกแถวอยู่ใน SAVEPOINT ของตัวเอง — แถวพังถูกข้ามพร้อมเหตุผล แถวอื่นไปต่อได้
// dry run: ผู้เรียก ROLLBACK ทั้ง transaction หลังได้รายงาน
import { z } from "zod";
import { type Queryable, writeAudit } from "../audit.ts";
import { HttpError } from "../errors.ts";
import { fyOf } from "../tb/dates.ts";
import { isEntityId } from "../tb/ids.ts";
import { fromSheetRecord, headerMap, type SheetKind } from "../tb/sheetRows.ts";
import { contactInput, CONTACT_KEYS, patientInput, PATIENT_KEYS, visitInput, type FollowupInputData } from "../validation.ts";
import type { Actor, Row } from "./common.ts";
import { createContact, updateContact } from "./contacts.ts";
import { createPatient, updatePatient } from "./patients.ts";
import { createVisit, updateVisit } from "./visits.ts";

export type ImportMode = "excel" | "migrate";

export interface ImportReport {
  kind: SheetKind;
  read: number;
  added: number;
  updated: number;
  skipped: { row: number; reason: string }[];
  unknownHeaders: string[];
}

interface Ctx {
  db: Queryable;
  actor: Actor;
  mode: ImportMode;
  units: Map<string, number>;
}

const zodMessage = (e: z.ZodError) =>
  e.issues.map((i) => `${i.path.join(".") || "แถว"}: ${i.message}`).join("; ");

/** ค่าเดิมใน DB + ค่าใหม่ที่ไม่ว่าง (ช่องว่างไม่ลบค่าเดิม) */
function mergeNonEmpty(existing: Row | null, incoming: Record<string, unknown>, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = incoming[k];
    out[k] = v === null || v === undefined ? existing?.[k] ?? null : v;
  }
  return out;
}

async function findOne(db: Queryable, sql: string, params: unknown[]): Promise<Row | null> {
  const [rows] = await db.query<Row[]>(sql, params);
  return rows[0] ?? null;
}

function unitIdOf(ctx: Ctx, name: string | null): number | null | "unknown" {
  if (!name) return null;
  return ctx.units.get(name.trim()) ?? "unknown";
}

async function migrateAudit(ctx: Ctx, entity: "patient" | "contact" | "visit", id: string, patientId: string | null,
  meta: { updatedBy: string | null; updatedAt: string | null }) {
  if (ctx.mode !== "migrate") return;
  await writeAudit(ctx.db, {
    userId: null, action: "migrate", entity, entityId: id, patientId,
    changes: { "แก้ไขโดย (ระบบเดิม)": [null, meta.updatedBy], "แก้ไขเมื่อ (ระบบเดิม)": [null, meta.updatedAt] },
  });
}

async function importPatient(ctx: Ctx, rec: Record<string, unknown>): Promise<"added" | "updated"> {
  const p = fromSheetRecord("patient", rec);
  if (p.errors.length) throw new HttpError(400, p.errors.join("; "));
  if (!p.data.name) throw new HttpError(400, "ไม่มีชื่อ");
  const unit = unitIdOf(ctx, p.meta.unitName);
  if (unit === "unknown") throw new HttpError(400, `ไม่รู้จักหน่วยบริการ "${p.meta.unitName}"`);
  if (unit) p.data.unit_id = unit;
  if (p.id && !isEntityId(p.id, "P")) throw new HttpError(400, `รหัสระบบไม่ถูกต้อง: ${p.id}`);
  if (ctx.mode === "migrate" && !p.id) throw new HttpError(400, "ไม่มีรหัสระบบ");

  let existing = p.id ? await findOne(ctx.db, "SELECT * FROM tb_patients WHERE id = ? AND deleted_at IS NULL", [p.id]) : null;
  if (!existing && ctx.mode === "excel" && p.data.hn) {
    const d = (p.data.start_date || p.data.diag_date) as string | null;
    const fy = d ? fyOf(d) : Number(p.data.fy) || null;
    if (fy) existing = await findOne(ctx.db, "SELECT * FROM tb_patients WHERE fy = ? AND hn = ? AND deleted_at IS NULL", [fy, p.data.hn]);
  }

  // ช่องติดตาม: ของเดิมทั้งหมด + ผลจากคอลัมน์เดือน2/5/6 ของไฟล์ (เฉพาะที่มีค่า)
  const [fuRows] = existing
    ? await ctx.db.query<Row[]>("SELECT slot, month_no, test, test_date, result, note FROM tb_treatment_followups WHERE patient_id = ? AND deleted_at IS NULL", [existing.id])
    : [[] as Row[]];
  const followups = new Map<number, FollowupInputData>(fuRows.map((f) => [Number(f.slot), f as unknown as FollowupInputData]));
  for (const f of p.legacyFollowups) {
    const cur = followups.get(f.slot);
    followups.set(f.slot, { slot: f.slot, month_no: f.month_no, test: f.test, test_date: cur?.test_date ?? null, result: f.result, note: cur?.note ?? null });
  }

  const merged = { ...mergeNonEmpty(existing, p.data, [...PATIENT_KEYS, "fy"]), followups: [...followups.values()] };
  const parsed = patientInput.safeParse(merged);
  if (!parsed.success) throw new HttpError(400, zodMessage(parsed.error));

  if (existing) {
    await updatePatient(ctx.db, existing.id as string, undefined, parsed.data, ctx.actor);
    await migrateAudit(ctx, "patient", existing.id as string, existing.id as string, p.meta);
    return "updated";
  }
  const { id } = await createPatient(ctx.db, parsed.data, ctx.actor, { id: p.id ?? undefined });
  await migrateAudit(ctx, "patient", id, id, p.meta);
  return "added";
}

async function importContact(ctx: Ctx, rec: Record<string, unknown>): Promise<"added" | "updated"> {
  const c = fromSheetRecord("contact", rec);
  if (c.errors.length) throw new HttpError(400, c.errors.join("; "));
  if (!c.data.name) throw new HttpError(400, "ไม่มีชื่อผู้สัมผัส");
  if (c.id && !isEntityId(c.id, "C")) throw new HttpError(400, `รหัสระบบไม่ถูกต้อง: ${c.id}`);
  if (ctx.mode === "migrate" && !c.id) throw new HttpError(400, "ไม่มีรหัสระบบ");

  const pid = c.data.patient_id as string | null;
  let patient = pid ? await findOne(ctx.db, "SELECT id, hn, fy, unit_id FROM tb_patients WHERE id = ? AND deleted_at IS NULL", [pid]) : null;
  if (!patient && c.meta.indexHn) {
    const fy = Number(c.data.fy) || null;
    patient = await findOne(
      ctx.db,
      `SELECT id, hn, fy, unit_id FROM tb_patients WHERE hn = ? AND deleted_at IS NULL ${fy ? "AND fy = ?" : ""} ORDER BY fy DESC LIMIT 1`,
      fy ? [c.meta.indexHn, fy] : [c.meta.indexHn],
    );
  }
  if (!patient) throw new HttpError(400, `ไม่พบผู้ป่วย index HN ${c.meta.indexHn ?? "-"}`);
  c.data.patient_id = patient.id;

  let existing = c.id ? await findOne(ctx.db, "SELECT * FROM tb_contacts WHERE id = ? AND deleted_at IS NULL", [c.id]) : null;
  if (!existing && ctx.mode === "excel") {
    existing = await findOne(ctx.db, "SELECT * FROM tb_contacts WHERE patient_id = ? AND name = ? AND deleted_at IS NULL", [patient.id, c.data.name]);
  }

  const unit = unitIdOf(ctx, c.meta.unitName);
  if (unit === "unknown") throw new HttpError(400, `ไม่รู้จักหน่วยบริการ "${c.meta.unitName}"`);
  c.data.unit_id = unit ?? existing?.unit_id ?? patient.unit_id ?? null;
  if (!c.data.unit_id) throw new HttpError(400, "ไม่ระบุ รพ.สต.รับผิดชอบ (ผู้ป่วย index ก็ไม่มี)");

  const parsed = contactInput.safeParse(mergeNonEmpty(existing, c.data, CONTACT_KEYS));
  if (!parsed.success) throw new HttpError(400, zodMessage(parsed.error));

  let id: string;
  let result: "added" | "updated";
  if (existing) {
    id = existing.id as string;
    await updateContact(ctx.db, id, undefined, parsed.data, ctx.actor);
    result = "updated";
  } else {
    id = (await createContact(ctx.db, parsed.data, ctx.actor, { id: c.id ?? undefined })).id;
    result = "added";
  }
  // ผู้สัมผัสที่ลงทะเบียนเป็นผู้ป่วยแล้ว (รหัสผู้ป่วยใหม่) — ผูกเฉพาะเมื่อผู้ป่วยรายนั้นมีจริง
  const npid = c.data.new_patient_id as string | null;
  if (npid && isEntityId(npid, "P") && (await findOne(ctx.db, "SELECT id FROM tb_patients WHERE id = ?", [npid]))) {
    await ctx.db.execute("UPDATE tb_contacts SET new_patient_id = ? WHERE id = ?", [npid, id]);
  }
  await migrateAudit(ctx, "contact", id, patient.id as string, c.meta);
  return result;
}

async function importVisit(ctx: Ctx, rec: Record<string, unknown>): Promise<"added" | "updated"> {
  const v = fromSheetRecord("visit", rec);
  if (v.errors.length) throw new HttpError(400, v.errors.join("; "));
  if (ctx.actor.id === null) throw new HttpError(400, "บันทึกรายครั้งต้องระบุผู้นำเข้า (--as <username>)");
  const ref = v.meta.refId ?? "";
  if (!isEntityId(ref)) throw new HttpError(400, `รหัสผู้ป่วย/ผู้สัมผัสไม่ถูกต้อง: ${ref}`);
  if (v.id && !isEntityId(v.id, "V")) throw new HttpError(400, `รหัสระบบไม่ถูกต้อง: ${v.id}`);
  const parsed = visitInput.safeParse({
    ...v.data,
    patient_id: ref.startsWith("P") ? ref : null,
    contact_id: ref.startsWith("C") ? ref : null,
    detail: v.data.detail ?? "-",
    visit_type: v.data.visit_type ?? "อื่นๆ",
  });
  if (!parsed.success) throw new HttpError(400, zodMessage(parsed.error));
  const existing = v.id ? await findOne(ctx.db, "SELECT id FROM tb_visits WHERE id = ? AND deleted_at IS NULL", [v.id]) : null;
  if (existing) {
    await updateVisit(ctx.db, v.id!, parsed.data, ctx.actor);
    await migrateAudit(ctx, "visit", v.id!, null, v.meta);
    return "updated";
  }
  const { id } = await createVisit(ctx.db, parsed.data, ctx.actor, { id: v.id ?? undefined });
  await migrateAudit(ctx, "visit", id, null, v.meta);
  return "added";
}

const IMPORTERS = { patient: importPatient, contact: importContact, visit: importVisit } as const;

export async function importRecords(
  db: Queryable,
  kind: "patient" | "contact" | "visit",
  records: Record<string, unknown>[],
  actor: Actor,
  mode: ImportMode,
  /** แถวแรกของข้อมูลในไฟล์ (สำหรับรายงาน "แถว N") — หัวตารางคือแถว 1 */
  firstRowNumber = 2,
): Promise<ImportReport> {
  if (actor.role !== "admin") throw new HttpError(403, "เฉพาะทีม รพ. นำเข้าไฟล์ได้");
  const [unitRows] = await db.query<Row[]>("SELECT id, name FROM tb_units");
  const ctx: Ctx = { db, actor, mode, units: new Map(unitRows.map((u) => [String(u.name), Number(u.id)])) };

  const known = headerMap(kind);
  const unknownHeaders = [...new Set(records.flatMap((r) => Object.keys(r)))].filter((h) => !known.has(h.trim()));
  const report: ImportReport = { kind, read: records.length, added: 0, updated: 0, skipped: [], unknownHeaders };

  for (let i = 0; i < records.length; i++) {
    await db.query("SAVEPOINT import_row");
    try {
      const r = await IMPORTERS[kind](ctx, records[i]);
      report[r]++;
      await db.query("RELEASE SAVEPOINT import_row");
    } catch (err) {
      await db.query("ROLLBACK TO SAVEPOINT import_row");
      const msg = err instanceof HttpError ? err.message : (err as { code?: string }).code ?? String(err);
      report.skipped.push({ row: firstRowNumber + i, reason: msg });
    }
  }
  return report;
}
