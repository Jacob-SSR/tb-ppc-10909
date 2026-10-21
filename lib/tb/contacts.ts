// lib/tb/contacts.ts
// ผู้สัมผัส: isTB, สรุปจำนวนต่อผู้ป่วย (§6.3), แปลงผู้สัมผัสที่ป่วยเป็นผู้ป่วยใหม่

import { CONTACT_TYPE_LABEL, OUTCOME_ONGOING, TB_RESULT, type ContactType } from "./constants.ts";
import { fyOf, type IsoDate } from "./dates.ts";
import type { ContactRow, PatientRow } from "./types.ts";

type TBFields = Pick<
  ContactRow,
  "new_patient_id" | "screen_result" | "fu6_result" | "fu12_result" | "fu18_result" | "fu24_result"
>;

/** ผู้สัมผัสป่วยเป็นวัณโรค = ผูกผู้ป่วยใหม่แล้ว หรือผลคัดกรอง/ผลติดตามใดๆ = "ป่วยเป็นวัณโรค" */
export function isTB(c: TBFields): boolean {
  if (c.new_patient_id) return true;
  return [c.screen_result, c.fu6_result, c.fu12_result, c.fu18_result, c.fu24_result].some(
    (r) => r?.trim() === TB_RESULT,
  );
}

/**
 * เงื่อนไขเดียวกับ isTB() สำหรับใช้ใน SQL (GROUP BY นับ TB ครั้งเดียว ไม่ต้อง N+1)
 * แก้ isTB() ต้องแก้ตรงนี้ด้วย — tests/db เทียบสองตัวนี้กับ MySQL จริง
 */
export function isTBSql(alias = "c"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`alias ไม่ถูกต้อง: ${alias}`);
  const cols = ["screen_result", "fu6_result", "fu12_result", "fu18_result", "fu24_result"]
    .map((col) => `TRIM(${alias}.${col})`)
    .join(", ");
  return `(${alias}.new_patient_id IS NOT NULL OR '${TB_RESULT}' IN (${cols}))`;
}

// ── สรุปผู้สัมผัสต่อผู้ป่วย (§6.3) ─────────────────────────────────────────────

export interface ContactCountRow {
  patient_id: string;
  contact_type: ContactType;
  total: number | string; // COUNT/SUM จาก mysql2 อาจเป็นสตริง
  tb: number | string | null;
}

export interface ContactGroupCount {
  total: number;
  tb: number;
}

export interface ContactSummary {
  total: number;
  tb: number;
  household: ContactGroupCount;
  close: ContactGroupCount;
}

export function emptyContactSummary(): ContactSummary {
  return { total: 0, tb: 0, household: { total: 0, tb: 0 }, close: { total: 0, tb: 0 } };
}

/**
 * รวมผลจาก
 *   SELECT patient_id, contact_type, COUNT(*) total, SUM(<isTBSql>) tb
 *   FROM tb_contacts WHERE deleted_at IS NULL GROUP BY patient_id, contact_type
 */
export function summarizeContacts(rows: readonly ContactCountRow[]): Map<string, ContactSummary> {
  const out = new Map<string, ContactSummary>();
  for (const r of rows) {
    const s = out.get(r.patient_id) ?? emptyContactSummary();
    const total = Number(r.total) || 0;
    const tb = Number(r.tb) || 0;
    s[r.contact_type].total += total;
    s[r.contact_type].tb += tb;
    s.total += total;
    s.tb += tb;
    out.set(r.patient_id, s);
  }
  return out;
}

/** "ผู้สัมผัส 5 · ร่วมบ้าน 3 (TB 1) · ใกล้ชิด 2 (TB 0)" */
export function formatContactSummary(s: ContactSummary): string {
  const g = (t: ContactType) => `${CONTACT_TYPE_LABEL[t]} ${s[t].total} (TB ${s[t].tb})`;
  return `ผู้สัมผัส ${s.total} · ${g("household")} · ${g("close")}`;
}

/**
 * สถานที่รักษาของผู้สัมผัสที่ป่วย
 * ลงทะเบียนในระบบเรา → reg_place ของผู้ป่วยรายนั้น (+ลิงก์), ไม่งั้น → tb_treat_place
 */
export function tbTreatPlace(
  c: Pick<ContactRow, "new_patient_id" | "tb_treat_place">,
  newPatient?: Pick<PatientRow, "id" | "reg_place"> | null,
): { place: string | null; patientId: string | null } {
  if (c.new_patient_id) {
    return {
      place: newPatient?.reg_place ?? c.tb_treat_place ?? null,
      patientId: c.new_patient_id,
    };
  }
  return { place: c.tb_treat_place ?? null, patientId: null };
}

// ── convertContactToPatient (ส่วนที่ไม่แตะ DB) ─────────────────────────────────

export type NewPatientDraft = Pick<
  PatientRow,
  | "id" | "fy" | "name" | "hn" | "cid" | "sex" | "age" | "address" | "unit_id" | "phone"
  | "start_date" | "diag_date" | "patient_type" | "reg_place" | "outcome" | "notes"
>;

/**
 * ผู้สัมผัสป่วย → ร่างผู้ป่วยใหม่ + ค่าที่ต้องอัปเดตกลับที่ผู้สัมผัส (ตาม convertContactToPatient เดิม)
 * Phase 3 เอาไป INSERT tb_patients + UPDATE tb_contacts ใน transaction เดียวกัน
 * ผู้เรียกต้องเช็คก่อนว่า new_patient_id ยังว่าง ("ลงทะเบียนเป็นผู้ป่วยแล้ว")
 */
export function patientDraftFromContact(
  c: Pick<
    ContactRow,
    "name" | "hn" | "cid" | "sex" | "age" | "address" | "current_address" | "unit_id" | "phone" | "screen_date"
  >,
  opts: { id: string; startDate: IsoDate | null; indexHn: string | null; today: IsoDate },
): { patient: NewPatientDraft; contactUpdate: Pick<ContactRow, "new_patient_id" | "screen_result"> } {
  return {
    patient: {
      id: opts.id,
      fy: fyOf(opts.startDate || c.screen_date || opts.today),
      name: c.name,
      hn: c.hn,
      cid: c.cid,
      sex: c.sex,
      age: c.age,
      // ที่อยู่ปัจจุบัน (ใหม่ §6.5) ใช้ติดตามได้จริงกว่า ไม่มีค่อยใช้ที่อยู่ตามทะเบียน
      address: c.current_address || c.address,
      unit_id: c.unit_id,
      phone: c.phone,
      start_date: opts.startDate,
      diag_date: c.screen_date,
      patient_type: "NEW",
      reg_place: "รพ.พลับพลาชัย",
      outcome: OUTCOME_ONGOING,
      notes: `พบจากการคัดกรองผู้สัมผัสของ HN ${opts.indexHn ?? ""}`.trim(),
    },
    contactUpdate: { new_patient_id: opts.id, screen_result: TB_RESULT },
  };
}
